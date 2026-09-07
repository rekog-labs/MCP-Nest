#!/usr/bin/env bash
#
# Roll back a broken published release.
#
# This runs ONLY when the packages were actually published and the post-publish
# smoke test failed. It is deliberately "best effort": every step is allowed to
# fail without aborting the remaining steps, because a partial rollback that
# still opens the GitHub issue is far better than an aborted one that leaves the
# maintainer unaware.
#
# Order matters:
#   1. move the dist-tag (latest|next) back to the previous good version, so a
#      fresh `npm install @rekog/mcp-nest` stops resolving to the broken build
#      immediately -- this is the only step users feel;
#   2. unpublish the broken versions, auth first (it peer-depends on core);
#   3. deprecate whatever could not be unpublished, as the fallback;
#   4. mark the GitHub release as a pre-release with a "rolled back" banner;
#   5. open an issue assigned to the maintainer -- the single ping.
#
# npm policy notes (docs.npmjs.com/policies/unpublish):
#   - a version can be unpublished within 72h of publishing as long as no other
#     package in the public registry depends on it; we run minutes after the
#     publish, so we are well inside that window;
#   - `package@version` can NEVER be reused. The follow-up fix must go out as a
#     NEW patch version, not a re-publish of the rolled-back one.
#
# Environment:
#   TAG        required  git tag of the release, e.g. v2.0.3
#   VERSION    required  version without the leading v, e.g. 2.0.3
#   NPM_TAG    optional  dist-tag that was published to (default: latest)
#   PREV_CORE  optional  version @rekog/mcp-nest's NPM_TAG pointed at before
#   PREV_AUTH  optional  version @rekog/mcp-nest-auth's NPM_TAG pointed at before
#   DRY_RUN    optional  1 = echo the npm/gh commands instead of running them
#   SKIP_NPM   optional  1 = skip every npm step (set when NPM_TOKEN is absent)
#   RUN_URL    optional  URL of the workflow run, for the issue body
#   ASSIGNEE   optional  issue assignee (default: rinormaloku)
#   LABEL      optional  issue label (default: release-broken)
#
set -euo pipefail

TAG="${TAG:-}"
VERSION="${VERSION:-}"
NPM_TAG="${NPM_TAG:-latest}"
PREV_CORE="${PREV_CORE:-}"
PREV_AUTH="${PREV_AUTH:-}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_NPM="${SKIP_NPM:-0}"
RUN_URL="${RUN_URL:-(run url unavailable)}"
ASSIGNEE="${ASSIGNEE:-rinormaloku}"
LABEL="${LABEL:-release-broken}"

CORE_PKG='@rekog/mcp-nest'
AUTH_PKG='@rekog/mcp-nest-auth'

if [ -z "$TAG" ] || [ -z "$VERSION" ]; then
  echo "::error::rollback.sh needs both TAG and VERSION" >&2
  exit 2
fi

# Human-readable log of what actually happened, reused verbatim in the issue.
REPORT_FILE="$(mktemp)"
note() {
  echo "$*"
  echo "$*" >>"$REPORT_FILE"
}

# Run a command, or echo it under DRY_RUN. Never aborts the script: the caller
# decides what to do with the exit status.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY-RUN: $*"
    return 0
  fi
  "$@"
}

npm_run() {
  run "$@"
}

echo "=============================================="
echo " Rolling back $TAG (version $VERSION, dist-tag $NPM_TAG)"
echo " previous $CORE_PKG@$NPM_TAG: ${PREV_CORE:-<none>}"
echo " previous $AUTH_PKG@$NPM_TAG: ${PREV_AUTH:-<none>}"
echo " DRY_RUN=$DRY_RUN SKIP_NPM=$SKIP_NPM"
echo "=============================================="

# ---------------------------------------------------------------------------
# 1. Move the dist-tag back to the last known-good version.
# ---------------------------------------------------------------------------
restore_dist_tag() {
  local pkg="$1" prev="$2"
  if [ -z "$prev" ]; then
    note "- dist-tag: $pkg had no previous \`$NPM_TAG\` recorded; left as published."
    return 0
  fi
  if npm_run npm dist-tag add "$pkg@$prev" "$NPM_TAG"; then
    note "- dist-tag: $pkg \`$NPM_TAG\` -> $prev (was $VERSION)."
  else
    note "- dist-tag: FAILED to move $pkg \`$NPM_TAG\` back to $prev -- do this by hand."
  fi
}

if [ "$SKIP_NPM" = "1" ]; then
  note "- **npm steps were SKIPPED**: no write-capable \`NPM_TOKEN\` was available to the job."
  note "  \`$NPM_TAG\` still points at the broken $VERSION on both packages. Fix this by hand, now."
else
  restore_dist_tag "$CORE_PKG" "$PREV_CORE"
  restore_dist_tag "$AUTH_PKG" "$PREV_AUTH"
fi

# ---------------------------------------------------------------------------
# 2. Unpublish the broken versions. Auth first: it peer-depends on core, so
#    removing core while auth still points at it would leave a dangling peer.
# 3. Whatever refuses to unpublish gets deprecated instead.
# ---------------------------------------------------------------------------
remove_version() {
  local pkg="$1" prev="$2"
  if npm_run npm unpublish "$pkg@$VERSION"; then
    note "- unpublished: $pkg@$VERSION."
    return 0
  fi

  note "- unpublish FAILED for $pkg@$VERSION; falling back to deprecate."
  local msg="Broken release $VERSION, rolled back; use ${prev:-a previous version}"
  if npm_run npm deprecate "$pkg@$VERSION" "$msg"; then
    note "- deprecated: $pkg@$VERSION (\"$msg\")."
  else
    note "- deprecate FAILED for $pkg@$VERSION -- this version is still live, fix by hand."
  fi
}

if [ "$SKIP_NPM" != "1" ]; then
  remove_version "$AUTH_PKG" "$PREV_AUTH"
  remove_version "$CORE_PKG" "$PREV_CORE"
fi

# ---------------------------------------------------------------------------
# 4. Mark the GitHub release as a pre-release with a rolled-back banner.
#    The release exists in both entry paths: the `release: published` event
#    obviously, and workflow_call because auto-release.yml creates it before
#    calling us.
# ---------------------------------------------------------------------------
EXISTING_NOTES=""
if [ "$DRY_RUN" != "1" ]; then
  EXISTING_NOTES="$(gh release view "$TAG" --json body -q .body 2>/dev/null || true)"
fi

if [ "$SKIP_NPM" = "1" ]; then
  ROLLBACK_SUMMARY="> No npm write token was available, so \`$NPM_TAG\` STILL POINTS AT $VERSION on
> the registry. This needs a manual fix."
else
  ROLLBACK_SUMMARY="> \`$NPM_TAG\` was moved back to ${PREV_CORE:-the previous version} and $VERSION was
> unpublished (or deprecated if unpublish was refused)."
fi

RELEASE_NOTES="> **ROLLED BACK** - the post-publish smoke test failed for $VERSION.
$ROLLBACK_SUMMARY
> Do not use this release.
> Run: $RUN_URL

$EXISTING_NOTES"

if run gh release edit "$TAG" --prerelease --notes "$RELEASE_NOTES"; then
  note "- GitHub release $TAG marked as pre-release with a rolled-back banner."
else
  note "- FAILED to edit GitHub release $TAG -- mark it a pre-release by hand."
fi

# ---------------------------------------------------------------------------
# 5. Open the issue. This is the single notification the maintainer gets.
# ---------------------------------------------------------------------------
# `--force` makes label creation idempotent; tolerate failure either way.
run gh label create "$LABEL" --color B60205 \
  --description "A published release was rolled back" --force || \
  echo "note: could not create/update label '$LABEL'; continuing"

ISSUE_BODY_FILE="$(mktemp)"
{
  echo "The published release **$TAG** ($VERSION) failed its post-publish smoke test and was rolled back automatically."
  echo
  echo "**Failing run:** $RUN_URL"
  echo
  echo "## What the rollback did"
  echo
  cat "$REPORT_FILE"
  echo
  echo "## Previous good versions"
  echo
  echo "| package | previous \`$NPM_TAG\` |"
  echo "|---|---|"
  echo "| \`$CORE_PKG\` | ${PREV_CORE:-_unknown_} |"
  echo "| \`$AUTH_PKG\` | ${PREV_AUTH:-_unknown_} |"
  echo
  echo "## What to do"
  echo
  echo "1. Open the run above and read the failing smoke/e2e step -- that is the actual bug."
  echo "2. Confirm the rollback landed: \`npm view $CORE_PKG dist-tags\` and \`npm view $AUTH_PKG dist-tags\` should show \`$NPM_TAG\` on the previous version, and \`npm view $CORE_PKG versions\` should no longer list $VERSION."
  echo "3. Fix the bug on \`main\`."
  echo "4. Release a **new** patch version. npm never lets \`package@$VERSION\` be reused, even after an unpublish, so $VERSION is burned."
  echo "5. If any line above says FAILED, do that step by hand before releasing again."
  echo
  echo "_Opened automatically by the release rollback job._"
} >"$ISSUE_BODY_FILE"

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY-RUN: gh issue create --title 'Release $TAG is broken and was rolled back' --assignee $ASSIGNEE --label $LABEL --body-file <<"
  echo "----- issue body -----"
  cat "$ISSUE_BODY_FILE"
  echo "----- end issue body -----"
else
  if gh issue create \
    --title "Release $TAG is broken and was rolled back" \
    --assignee "$ASSIGNEE" \
    --label "$LABEL" \
    --body-file "$ISSUE_BODY_FILE"; then
    echo "Opened rollback issue for $TAG."
  else
    echo "::error::Failed to open the rollback issue for $TAG. Body follows so it is not lost:"
    cat "$ISSUE_BODY_FILE"
  fi
fi

echo "Rollback of $TAG finished."
