#!/usr/bin/env bash
#
# Decide whether the current state of `main` should be auto-released as a
# security patch.
#
# Two conditions, both required:
#
#   1. EVERY commit in BASE_TAG..HEAD_SHA was authored by a bot
#      (`dependabot[bot]` or `github-actions[bot]`).
#      Rationale: a release ships all of `main`, so a half-finished feature
#      sitting unreleased on `main` must not be dragged out by a dependency
#      bump. If a human touched main since the last tag, the maintainer
#      decides when that ships.
#
#   2. The diff BASE_TAG..HEAD_SHA touches a *shipped* manifest --
#      packages/mcp-nest/package.json or packages/mcp-nest-auth/package.json.
#      Rationale: the published tarballs contain no lockfile, so users resolve
#      the dependency ranges themselves. A root package-lock.json-only bump
#      produces a byte-identical tarball and reaches nobody. Those merge, close
#      their alert, and stop there.
#
# Condition 0: no open issue labelled `release-broken`. The rollback opens one
# when a published version failed its smoke test. Until the maintainer closes
# it, an automated release would just re-release the same broken `main` every
# few hours (and the roll-forward would burn another version number each time).
#
# Inputs (environment):
#   BROKEN_LABEL       issue label that pauses releases (default: release-broken)
#   OPEN_BROKEN_ISSUES offline testing only: number of open issues to assume
#   BASE_TAG           last non-prerelease tag, e.g. v2.0.2      (required)
#   HEAD_SHA           commit to release, e.g. $GITHUB_SHA       (required)
#   REPO               owner/name, e.g. rekog-labs/MCP-Nest      (required unless COMPARE_JSON_FILE)
#   GH_TOKEN           token for `gh api`                        (required unless COMPARE_JSON_FILE)
#   COMPARE_JSON_FILE  read the compare payload from this file instead of
#                      calling the API -- offline testing only.
#
# Outputs: `release=true|false` and `reason=<one line>` on stdout, and appended
# to $GITHUB_OUTPUT when that is set. Always exits 0 for a decision; non-zero
# only when it could not decide (bad input, API failure).
#
# Why the API and not local git: `main` takes squash merges, and the squash
# commit's *git* author is rewritten (see the note in auto-release.yml). The
# compare payload carries `.commits[].author.login`, the GitHub *account*
# attributed to the commit, which is what actually identifies the bot.

set -euo pipefail

fail() {
  echo "decide: $*" >&2
  exit 2
}

# One line, no CR/LF -- `reason` goes into $GITHUB_OUTPUT as a key=value pair
# and a newline there would corrupt the output file.
emit() {
  local release="$1" reason="$2"
  reason="$(printf '%s' "$reason" | tr '\n\r' '  ')"
  echo "release=${release}"
  echo "reason=${reason}"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "release=${release}"
      echo "reason=${reason}"
    } >> "$GITHUB_OUTPUT"
  fi
  exit 0
}

command -v jq >/dev/null 2>&1 || fail "jq is required"

: "${BASE_TAG:?BASE_TAG is required (latest non-prerelease tag, e.g. v2.0.2)}"
: "${HEAD_SHA:?HEAD_SHA is required (commit to release)}"

# Accounts allowed to trigger an unattended release.
BOT_LOGINS='["dependabot[bot]","github-actions[bot]"]'
# Fallback identification when `.author` is null -- i.e. GitHub could not map
# the commit to an account (happens for commits authored by an app whose
# account link was dropped, or on a fork). These are the fixed noreply
# addresses GitHub uses for the two bots.
BOT_EMAILS='["49699333+dependabot[bot]@users.noreply.github.com","41898282+github-actions[bot]@users.noreply.github.com"]'

# Manifests that actually ship. Root package.json / package-lock.json / bun.lock
# are deliberately absent: they are not in the published tarballs.
SHIPPED_MANIFESTS='["packages/mcp-nest/package.json","packages/mcp-nest-auth/package.json"]'

# In CI, HEAD_SHA is $GITHUB_SHA -- already a full SHA. Run by hand it is more
# likely to be something like `origin/main`, which is a name only this clone
# knows: the API would 404 on it. Resolve any such local ref to the SHA the
# API can actually look up, and leave anything git cannot resolve untouched
# (a bare `main` is a valid ref on the API side).
if [ -n "${HEAD_SHA:-}" ] && [[ ! "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  if resolved="$(git rev-parse --verify --quiet "${HEAD_SHA}^{commit}" 2>/dev/null)" \
     && [ -n "$resolved" ]; then
    echo "decide: resolved HEAD_SHA '${HEAD_SHA}' -> ${resolved}"
    HEAD_SHA="$resolved"
  fi
fi

# --- Condition 0: releases are paused while a rollback issue is open ---------
BROKEN_LABEL="${BROKEN_LABEL:-release-broken}"
if [ -n "${COMPARE_JSON_FILE:-}" ]; then
  open_broken="${OPEN_BROKEN_ISSUES:-0}"
else
  : "${REPO:?REPO is required (owner/name), or set COMPARE_JSON_FILE}"
  command -v gh >/dev/null 2>&1 || fail "gh is required"
  # A label that does not exist yet simply matches nothing.
  open_broken="$(gh issue list --repo "$REPO" --state open --label "$BROKEN_LABEL" --limit 1 --json number --jq 'length' 2>/dev/null || echo 0)"
fi
if [ "${open_broken:-0}" -gt 0 ]; then
  emit false "an open '${BROKEN_LABEL}' issue exists; automated releases are paused until it is closed"
fi

if [ -n "${COMPARE_JSON_FILE:-}" ]; then
  [ -r "$COMPARE_JSON_FILE" ] || fail "COMPARE_JSON_FILE '$COMPARE_JSON_FILE' is not readable"
  compare="$(cat "$COMPARE_JSON_FILE")"
else
  : "${REPO:?REPO is required (owner/name), or set COMPARE_JSON_FILE}"
  command -v gh >/dev/null 2>&1 || fail "gh is required"
  # Three dots: compare from the merge base, matching what actually landed.
  # Deliberately NOT --paginate: gh would emit one JSON object per page and jq
  # would choke. The single-page caps are handled by the truncation guard below.
  compare="$(gh api "repos/${REPO}/compare/${BASE_TAG}...${HEAD_SHA}")" \
    || fail "gh api compare ${BASE_TAG}...${HEAD_SHA} failed"
fi

echo "$compare" | jq -e 'type == "object" and has("commits")' >/dev/null 2>&1 \
  || fail "compare payload is not a commit-comparison object"

commit_count="$(echo "$compare" | jq '.commits | length')"
echo "decide: ${BASE_TAG}...${HEAD_SHA} -> ${commit_count} commit(s)"

if [ "$commit_count" -eq 0 ]; then
  emit false "no commits since ${BASE_TAG}; nothing to release"
fi

# The compare endpoint caps `.commits` at 250 and `.files` at 300. Both caps
# only ever make us *miss* a commit or a file, and both checks below are
# "release only if I can see it is safe", so a truncated payload can never
# turn into a spurious release -- but a 250-commit gap is so far outside the
# bot-only case that it is worth refusing loudly rather than analysing.
if [ "$commit_count" -ge 250 ]; then
  emit false "compare response is truncated at ${commit_count} commits; too far behind ${BASE_TAG} for an automated release"
fi

# --- Condition 1: every commit is a bot commit -------------------------------

non_bot="$(
  echo "$compare" | jq -r --argjson logins "$BOT_LOGINS" --argjson emails "$BOT_EMAILS" '
    .commits[]
    | select(
        ((.author.login // null) as $l | $l != null and ($logins | index($l)) != null)
        or
        ((.author // null) == null
         and ((.commit.author.email // "") as $e | ($emails | index($e)) != null))
        | not
      )
    | "\(.sha[0:7]) \(.author.login // .commit.author.email // "unknown")"
  '
)"

if [ -n "$non_bot" ]; then
  echo "decide: non-bot commits since ${BASE_TAG}:" >&2
  echo "$non_bot" >&2
  first="$(echo "$non_bot" | head -n 1)"
  count="$(echo "$non_bot" | wc -l | tr -d ' ')"
  emit false "${count} non-bot commit(s) since ${BASE_TAG} (first: ${first}); a human decides when main ships"
fi

echo "decide: all ${commit_count} commit(s) are bot commits"

# --- Condition 2: a shipped dependency range changed -------------------------

shipped="$(
  echo "$compare" | jq -r --argjson manifests "$SHIPPED_MANIFESTS" '
    [.files // [] | .[].filename | select(. as $f | $manifests | index($f) != null)]
    | unique | .[]
  '
)"

if [ -z "$shipped" ]; then
  changed="$(echo "$compare" | jq -r '[.files // [] | .[].filename] | join(", ")')"
  echo "decide: files changed: ${changed:-<none>}"
  emit false "lockfile-only: no shipped manifest changed between ${BASE_TAG} and ${HEAD_SHA} (published tarballs carry no lockfile, so nothing reaches users)"
fi

echo "decide: shipped manifest(s) changed:"
echo "$shipped" | sed 's/^/  /'

manifest_list="$(echo "$shipped" | paste -sd, - )"
emit true "${commit_count} bot commit(s) since ${BASE_TAG} and a shipped dependency range changed (${manifest_list})"
