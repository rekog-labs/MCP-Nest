#!/usr/bin/env bash
#
# One-time GitHub settings for the hands-off security-patch pipeline.
# Needs an admin token (`gh auth status`). Every step is idempotent: re-running
# it is safe. See SECURITY-AUTOMATION-PLAN.md.
#
#   scripts/release/admin-setup.sh            # apply
#   DRY_RUN=1 scripts/release/admin-setup.sh  # print the calls only
#
# No npm token is needed anywhere: publishing (including the roll-forward after
# a broken release) uses OIDC trusted publishing.
set -euo pipefail

REPO=${REPO:-rekog-labs/MCP-Nest}
RULESET_ID=${RULESET_ID:-13374404}   # "protect-main"
GITHUB_ACTIONS_APP_ID=15368          # integration_id for check runs from GitHub Actions
DRY_RUN=${DRY_RUN:-0}

run() {
  if [ "$DRY_RUN" = "1" ]; then printf 'DRY: gh %s\n' "$*"; else gh "$@"; fi
}

echo "==> 1/4 Allow auto-merge on the repository"
run api -X PATCH "repos/$REPO" -F allow_auto_merge=true --silent

echo "==> 2/4 Allow GitHub Actions (GITHUB_TOKEN) to approve pull requests"
# dependabot-automerge.yml runs `gh pr review --approve`; without this switch
# that call is refused and nothing ever merges.
run api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read \
  -F can_approve_pull_request_reviews=true

echo "==> 3/4 Ruleset $RULESET_ID: require the CI checks before merge"
# Keeps the existing rules (no deletion, no force-push, 1 approving review,
# org-admin bypass) and adds required status checks. Auto-merge only fires
# once every required check is green, so this is the safety gate.
tmp=$(mktemp)
cat > "$tmp" <<JSON
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": null, "actor_type": "OrganizationAdmin", "bypass_mode": "always" }
  ],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "allowed_merge_methods": ["merge", "squash", "rebase"],
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": true,
        "required_approving_review_count": 1,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "test (20.x)", "integration_id": $GITHUB_ACTIONS_APP_ID },
          { "context": "test (22.x)", "integration_id": $GITHUB_ACTIONS_APP_ID },
          { "context": "test (24.x)", "integration_id": $GITHUB_ACTIONS_APP_ID },
          { "context": "e2e",         "integration_id": $GITHUB_ACTIONS_APP_ID }
        ]
      }
    }
  ]
}
JSON
if [ "$DRY_RUN" = "1" ]; then echo "DRY: gh api -X PUT repos/$REPO/rulesets/$RULESET_ID --input <json>"; cat "$tmp"; else
  gh api -X PUT "repos/$REPO/rulesets/$RULESET_ID" --input "$tmp" --jq '{name, enforcement, rules: [.rules[].type]}'
fi
rm -f "$tmp"

echo "==> 4/4 Label used by the rollback issue"
run label create release-broken --repo "$REPO" --color B60205 \
  --description "A published version failed its smoke test and was rolled back" --force

echo
echo "Done. No npm token is needed: a broken release is rolled forward via OIDC and an"
echo "issue with the manual npm cleanup commands is assigned to you."
