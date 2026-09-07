#!/usr/bin/env bash
#
# Record a broken published release and page the maintainer.
#
# Runs ONLY when the packages were actually published and the post-publish
# smoke test failed. By then the `roll-forward` job (publish.yml) has normally
# re-published the last good code as the next version through OIDC, so users
# on a caret range are already safe; ROLLED_FORWARD carries that version.
#
# This script touches GitHub only. It never talks to npm: OIDC trusted
# publishing can only `npm publish`, and the maintainer decided that cleaning
# up the broken version on the registry (deprecate / unpublish) is a human
# step, driven by the issue this script opens.
#
#   1. mark the GitHub release as a pre-release with a "rolled back" banner;
#   2. open an issue assigned to the maintainer -- the single ping -- with the
#      exact npm commands still to run by hand.
#
# Every step is best effort: a failure is logged and the remaining steps run.
#
# Environment:
#   TAG             required  git tag of the release, e.g. v2.0.3
#   VERSION         required  version without the leading v, e.g. 2.0.3
#   NPM_TAG         optional  dist-tag that was published to (default: latest)
#   PREV_CORE       optional  version @rekog/mcp-nest's NPM_TAG pointed at before
#   PREV_AUTH       optional  version @rekog/mcp-nest-auth's NPM_TAG pointed at before
#   ROLLED_FORWARD  optional  version the roll-forward job published (empty if none)
#   DRY_RUN         optional  1 = echo the gh commands instead of running them
#   RUN_URL         optional  URL of the workflow run, for the issue body
#   ASSIGNEE        optional  issue assignee (default: rinormaloku)
#   LABEL           optional  issue label (default: release-broken)
#
set -euo pipefail

TAG="${TAG:-}"
VERSION="${VERSION:-}"
NPM_TAG="${NPM_TAG:-latest}"
PREV_CORE="${PREV_CORE:-}"
PREV_AUTH="${PREV_AUTH:-}"
ROLLED_FORWARD="${ROLLED_FORWARD:-}"
DRY_RUN="${DRY_RUN:-0}"
RUN_URL="${RUN_URL:-(run url unavailable)}"
ASSIGNEE="${ASSIGNEE:-rinormaloku}"
LABEL="${LABEL:-release-broken}"

CORE_PKG='@rekog/mcp-nest'
AUTH_PKG='@rekog/mcp-nest-auth'

if [ -z "$TAG" ] || [ -z "$VERSION" ]; then
  echo "::error::rollback.sh needs both TAG and VERSION" >&2
  exit 2
fi

# Human-readable log of what happened, reused verbatim in the issue.
REPORT_FILE="$(mktemp)"
note() {
  echo "$*"
  echo "$*" >>"$REPORT_FILE"
}

# Run a command, or echo it under DRY_RUN. Never aborts the script.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY-RUN: $*"
    return 0
  fi
  "$@"
}

echo "=============================================="
echo " Recording broken release $TAG (version $VERSION, dist-tag $NPM_TAG)"
echo " previous $CORE_PKG@$NPM_TAG: ${PREV_CORE:-<none>}"
echo " previous $AUTH_PKG@$NPM_TAG: ${PREV_AUTH:-<none>}"
echo " rolled forward to: ${ROLLED_FORWARD:-<no roll-forward>}"
echo " DRY_RUN=$DRY_RUN"
echo "=============================================="

if [ -n "$ROLLED_FORWARD" ]; then
  note "- roll-forward: the code of ${PREV_CORE:-the previous release} was re-published as **$ROLLED_FORWARD**; \`$NPM_TAG\` now points at it. Users on a caret range are safe."
  USERS_SAFE=1
else
  note "- **roll-forward did NOT happen.** \`$NPM_TAG\` still points at the broken $VERSION on both packages. Fix this by hand, now (commands below)."
  USERS_SAFE=0
fi
note "- $VERSION is still listed on npm. Deprecate or unpublish it by hand (commands below)."

# ---------------------------------------------------------------------------
# 1. Mark the GitHub release as a pre-release with a rolled-back banner.
#    The release exists in both entry paths: the `release: published` event
#    obviously, and workflow_call because auto-release.yml creates it before
#    calling us.
# ---------------------------------------------------------------------------
EXISTING_NOTES=""
if [ "$DRY_RUN" != "1" ]; then
  EXISTING_NOTES="$(gh release view "$TAG" --json body -q .body 2>/dev/null || true)"
fi

if [ "$USERS_SAFE" = "1" ]; then
  SUMMARY="> The code of ${PREV_CORE:-the previous release} was re-published as $ROLLED_FORWARD; \`$NPM_TAG\` points at it."
else
  SUMMARY="> Roll-forward failed: \`$NPM_TAG\` STILL POINTS AT $VERSION on the registry. This needs a manual fix."
fi

RELEASE_NOTES="> **ROLLED BACK** - the post-publish smoke test failed for $VERSION.
$SUMMARY
> Do not use this release.
> Run: $RUN_URL

$EXISTING_NOTES"

if run gh release edit "$TAG" --prerelease --notes "$RELEASE_NOTES"; then
  note "- GitHub release $TAG marked as pre-release with a rolled-back banner."
else
  note "- FAILED to edit GitHub release $TAG -- mark it a pre-release by hand."
fi

# ---------------------------------------------------------------------------
# 2. Open the issue. This is the single notification the maintainer gets.
# ---------------------------------------------------------------------------
run gh label create "$LABEL" --color B60205 \
  --description "A published release failed its smoke test" --force || \
  echo "note: could not create/update label '$LABEL'; continuing"

ISSUE_BODY_FILE="$(mktemp)"
{
  echo "The published release **$TAG** ($VERSION) failed its post-publish smoke test."
  echo
  echo "**Failing run:** $RUN_URL"
  echo
  echo "## What the automation did"
  echo
  cat "$REPORT_FILE"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| previous \`$NPM_TAG\` of \`$CORE_PKG\` | ${PREV_CORE:-_unknown_} |"
  echo "| previous \`$NPM_TAG\` of \`$AUTH_PKG\` | ${PREV_AUTH:-_unknown_} |"
  echo "| roll-forward version | ${ROLLED_FORWARD:-_none_} |"
  echo
  echo "## What to do (by hand, needs your npm login)"
  echo
  if [ "$USERS_SAFE" != "1" ]; then
    echo "0. **Urgent - users still get the broken version.** Point \`$NPM_TAG\` back:"
    echo
    echo '```bash'
    echo "npm dist-tag add $CORE_PKG@${PREV_CORE:-<previous>} $NPM_TAG"
    echo "npm dist-tag add $AUTH_PKG@${PREV_AUTH:-<previous>} $NPM_TAG"
    echo '```'
    echo
  fi
  echo "1. Open the run above and read the failing smoke/e2e step -- that is the actual bug."
  echo "2. Remove the broken version from the registry. Deprecate always works; unpublish only inside 72 h and only if nothing depends on it (do auth first, it peer-depends on core):"
  echo
  echo '```bash'
  echo "npm deprecate $CORE_PKG@$VERSION \"Broken release, use ${ROLLED_FORWARD:-${PREV_CORE:-a previous version}}\""
  echo "npm deprecate $AUTH_PKG@$VERSION \"Broken release, use ${ROLLED_FORWARD:-${PREV_AUTH:-a previous version}}\""
  echo "# or, within 72 h:"
  echo "npm unpublish $AUTH_PKG@$VERSION && npm unpublish $CORE_PKG@$VERSION"
  echo '```'
  echo
  echo "3. Fix the bug on \`main\`."
  echo "4. Release a **new** version. npm never lets \`package@$VERSION\` be reused, even after an unpublish, so $VERSION is burned."
  echo "5. If any line above says FAILED, do that step by hand before releasing again."
  echo "6. **Close this issue.** Automated releases stay paused while an open \`$LABEL\` issue exists, so the same broken state is not released again every few hours."
  echo
  echo "_Opened automatically by the release rollback job._"
} >"$ISSUE_BODY_FILE"

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY-RUN: gh issue create --title 'Release $TAG is broken' --assignee $ASSIGNEE --label $LABEL --body-file <<"
  echo "----- issue body -----"
  cat "$ISSUE_BODY_FILE"
  echo "----- end issue body -----"
else
  if gh issue create \
    --title "Release $TAG is broken and needs manual npm cleanup" \
    --assignee "$ASSIGNEE" \
    --label "$LABEL" \
    --body-file "$ISSUE_BODY_FILE"; then
    echo "Opened rollback issue for $TAG."
  else
    echo "::error::Failed to open the rollback issue for $TAG. Body follows so it is not lost:"
    cat "$ISSUE_BODY_FILE"
  fi
fi

echo "Rollback bookkeeping for $TAG finished."
