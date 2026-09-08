#!/usr/bin/env bash
#
# The body of the regraft GitHub Action.
#
# It lives in a file rather than inline in action.yml because it is long enough
# that YAML quoting would hide its bugs, and because you can run it locally.
#
# Every input arrives as an environment variable; see action.yml for what each
# one means.
set -euo pipefail

REGRAFT="npx --yes regraft@${INPUT_VERSION:-latest}"
BASE_BRANCH="${INPUT_BASE:-${GITHUB_REF_NAME}}"
STRATEGY="${INPUT_STRATEGY:-single}"
PR_LIMIT="${INPUT_OPEN_PULL_REQUESTS_LIMIT:-5}"
BRANCH_PREFIX="${INPUT_BRANCH_PREFIX:-regraft}"
TITLE_PREFIX="${INPUT_TITLE_PREFIX:-}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

note() { echo "$*" >> "$summary"; }
output() { echo "$1=$2" >> "${GITHUB_OUTPUT:-/dev/null}"; }

# --------------------------------------------------------------------------
# What are we missing?
# --------------------------------------------------------------------------

status_args=()
[ -n "${INPUT_FROM:-}" ] && status_args+=(--from "${INPUT_FROM}")

# `status` exits 1 when the repo is behind. That is the normal case here, not a
# failure, so only an exit code above 1 is a real error.
set +e
$REGRAFT status --json "${status_args[@]}" > /tmp/regraft-status.json
status_code=$?
set -e
if [ "$status_code" -gt 1 ]; then
  cat /tmp/regraft-status.json >&2 || true
  echo "::error::regraft status failed (exit ${status_code})"
  exit "$status_code"
fi

behind=$(node -p "require('/tmp/regraft-status.json').behind")
output behind "$behind"

note "## Template drift"
note ""
note "\`${behind}\` commit(s) behind the template."

if [ "$behind" -eq 0 ]; then
  note ""
  note "Nothing to do."
  output applied 0
  output pull-requests "[]"
  exit 0
fi

node -e '
  const s = require("/tmp/regraft-status.json");
  console.log("");
  console.log("| Commit | Subject | Author |");
  console.log("|---|---|---|");
  for (const c of s.commits) {
    console.log(`| \`${c.shortSha}\` | ${c.subject.replace(/\|/g, "\\|")} | ${c.author} |`);
  }
' >> "$summary"

if [ "${INPUT_CREATE_PULL_REQUEST:-true}" != "true" ]; then
  note ""
  note "_Reporting only — \`create-pull-request\` is off._"
  output applied 0
  output pull-requests "[]"
  exit 0
fi

git config user.name "${INPUT_GIT_NAME:-github-actions[bot]}"
git config user.email "${INPUT_GIT_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"

# --------------------------------------------------------------------------
# Open (or update) one pull request
# --------------------------------------------------------------------------

open_pr() {
  local branch="$1" title="$2" body="$3"

  git push --force-with-lease origin "$branch"

  local existing
  existing=$(gh pr list --head "$branch" --base "$BASE_BRANCH" --state open --json url --jq '.[0].url // empty')

  if [ -n "$existing" ]; then
    gh pr edit "$existing" --title "$title" --body "$body" >/dev/null
    echo "$existing"
    return
  fi

  local args=(--head "$branch" --base "$BASE_BRANCH" --title "$title" --body "$body")
  [ -n "${INPUT_LABELS:-}" ] && args+=(--label "${INPUT_LABELS}")
  [ -n "${INPUT_REVIEWERS:-}" ] && args+=(--reviewer "${INPUT_REVIEWERS}")
  [ -n "${INPUT_ASSIGNEES:-}" ] && args+=(--assignee "${INPUT_ASSIGNEES}")
  [ "${INPUT_DRAFT:-false}" = "true" ] && args+=(--draft)

  local url
  url=$(gh pr create "${args[@]}")

  if [ "${INPUT_AUTO_MERGE:-false}" = "true" ]; then
    # Never fatal: auto-merge is off on many repos, and losing the PR over it
    # would be worse than not having it.
    gh pr merge "$url" --auto --squash >/dev/null 2>&1 \
      || echo "::warning::Could not enable auto-merge (is it allowed on this repository?)"
  fi

  echo "$url"
}

body_for() {
  local applied="$1" overwritten="$2" scope="$3"
  APPLIED="$applied" OVERWRITTEN="$overwritten" SCOPE="$scope" node -e '
    const applied = process.env.APPLIED;
    const over = JSON.parse(process.env.OVERWRITTEN || "[]");
    let s = `Grafted **${applied}** commit(s) from the template, keeping their original authors, dates and messages.\n`;
    if (process.env.SCOPE) s += `\n${process.env.SCOPE}\n`;
    if (over.length) {
      s += `\n### The template overwrote\n\n` + over.map((f) => `- \`${f}\``).join("\n");
      s += `\n\nThis is the only place a graft loses something. If any of these belong to this repository rather than the template, add them to \`protect\` in \`.regraft.yml\`.\n`;
    }
    s += `\n---\n<sub>Opened by [regraft](https://github.com/achedon12/regraft) · [configure](https://github.com/achedon12/regraft/blob/main/docs/github-action.md)</sub>`;
    process.stdout.write(s);
  '
}

urls=()
total_applied=0

# --------------------------------------------------------------------------
# single — every pending commit in one pull request
# --------------------------------------------------------------------------

if [ "$STRATEGY" = "single" ]; then
  branch="${BRANCH_PREFIX}/template-sync"
  git checkout -B "$branch"

  apply_args=(--json --no-backup --allow-ahead)
  [ -n "${INPUT_FROM:-}" ] && apply_args+=(--from "${INPUT_FROM}")
  [ -n "${INPUT_LIMIT:-}" ] && apply_args+=(--limit "${INPUT_LIMIT}")

  $REGRAFT apply "${apply_args[@]}" > /tmp/regraft-apply.json

  total_applied=$(node -p "require('/tmp/regraft-apply.json').applied")
  overwritten=$(node -p "JSON.stringify(require('/tmp/regraft-apply.json').overwritten || [])")

  title="${TITLE_PREFIX}Sync ${total_applied} commit(s) from the template"
  url=$(open_pr "$branch" "$title" "$(body_for "$total_applied" "$overwritten" "")")
  urls+=("$url")

# --------------------------------------------------------------------------
# per-commit — one pull request per template commit, Dependabot-style
# --------------------------------------------------------------------------

elif [ "$STRATEGY" = "per-commit" ]; then
  count=0
  skipped=0

  while IFS=$'\t' read -r sha short subject; do
    [ -z "$sha" ] && continue
    if [ "$count" -ge "$PR_LIMIT" ]; then
      note ""
      note "_Stopped at \`open-pull-requests-limit\` (${PR_LIMIT}). The rest will follow once these are merged._"
      break
    fi

    branch="${BRANCH_PREFIX}/${short}"
    git checkout -B "$branch" "origin/${BASE_BRANCH}"

    # Each pull request grafts exactly one commit onto the base branch, so it
    # can be reviewed and merged on its own. A commit that depends on an earlier
    # one may not apply in isolation; that is reported and skipped rather than
    # forced.
    set +e
    $REGRAFT apply --json --no-backup --allow-ahead --from "${sha}~1" --limit 1 > /tmp/regraft-apply.json 2>/tmp/regraft-error.txt
    apply_code=$?
    set -e

    if [ "$apply_code" -ne 0 ]; then
      skipped=$((skipped + 1))
      note ""
      note "- \`${short}\` **skipped** — did not apply on its own:"
      note "  \`\`\`"
      sed 's/^/  /' /tmp/regraft-error.txt >> "$summary" || true
      note "  \`\`\`"
      git checkout -q "${BASE_BRANCH}" 2>/dev/null || git checkout -q -
      continue
    fi

    applied=$(node -p "require('/tmp/regraft-apply.json').applied")
    [ "$applied" -eq 0 ] && continue
    overwritten=$(node -p "JSON.stringify(require('/tmp/regraft-apply.json').overwritten || [])")

    title="${TITLE_PREFIX}${subject}"
    scope="Template commit \`${short}\`."
    url=$(open_pr "$branch" "$title" "$(body_for "$applied" "$overwritten" "$scope")")
    urls+=("$url")

    total_applied=$((total_applied + applied))
    count=$((count + 1))
  done < <(node -e '
    const s = require("/tmp/regraft-status.json");
    for (const c of s.commits) console.log([c.sha, c.shortSha, c.subject].join("\t"));
  ')

  [ "$skipped" -gt 0 ] && echo "::warning::${skipped} commit(s) did not apply on their own. Use strategy: single to graft them in order."

else
  echo "::error::Unknown strategy '${STRATEGY}'. Use 'single' or 'per-commit'."
  exit 1
fi

output applied "$total_applied"
output pull-requests "$(printf '%s\n' "${urls[@]:-}" | node -e '
  const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
  process.stdout.write(JSON.stringify(lines));
')"
[ "${#urls[@]}" -gt 0 ] && output pull-request-url "${urls[0]}"

note ""
note "### Pull requests"
note ""
for url in "${urls[@]:-}"; do [ -n "$url" ] && note "- ${url}"; done
