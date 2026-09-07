# Plan: hands-off security patching and releasing

Goal: dependency vulnerabilities get patched, tested, released, and verified without the
maintainer. The maintainer is pulled in for exactly one event: **a published version is
broken**. Everything else is silent.

## 1. What is true today (2026-09-07)

Measured, not assumed:

| Fact | Evidence |
|---|---|
| A fresh `npm install @rekog/mcp-nest@2.0.2 @rekog/mcp-nest-auth@2.0.2` has **0 vulnerabilities** | ran `npm audit` on a clean install in a scratch dir |
| All 12 open Dependabot alerts are in the **root `package-lock.json`** | `gh api .../dependabot/alerts` |
| 11 of 12 are `development` scope (`fast-uri` via ajv/eslint, `fastify` via dev `@nestjs/platform-fastify`, `@humanfs/node` via eslint) | same |
| The 1 `runtime` alert (`qs`) comes through `express`, which is a **peer** dependency, i.e. the user's own install | `npm ls qs` |
| Dependabot PRs pass CI (3 of 4 open ones are green) but show `mergeStateStatus: BLOCKED` | `gh pr view 252` |
| The block is the `protect-main` ruleset: **1 approving review required**, no required status checks, org-admin bypass | `gh api .../rulesets/13374404` |
| Repo has `allow_auto_merge: false` | `gh api repos/rekog-labs/MCP-Nest` |
| Dependabot edits only `package-lock.json`; the committed root `bun.lock` goes stale, hence the local `bun install` ritual (see commit 5f3453f) | PR file lists |
| PR #253 (fastify) fails because the fix needs `@nestjs/platform-fastify@12`, which needs NestJS 12 — not fixable inside Nest 11 | run log: `ERESOLVE` |
| Releases are manual: create a GitHub release → `publish.yml` builds, tests, runs e2e, publishes, then smoke-tests the published artifact | `.github/workflows/publish.yml` |
| Publish uses npm OIDC trusted publishing; that token can **only** `npm publish` (no `dist-tag`, `deprecate`, `unpublish`). A real npm write token is capped at 90 days since Oct 2025 | npm docs |
| The release pipeline takes ~5 min (publish 3 min incl. 2 min e2e, smoke 2 min) | last two publish runs |

Two consequences shape the design:

1. **Lockfile-only bumps never reach users.** The published tarballs contain `dist/`, `src/`,
   `package.json` — no lockfile. Users resolve `dependencies` ranges themselves. A release is
   only meaningful when a range in `packages/*/package.json` changes (or code changes).
2. **The merge friction is a repo-settings problem, not a Dependabot problem.** Review
   requirement + no auto-merge + stale second lockfile. Fix those three and Dependabot PRs
   can merge themselves.

## 2. Target behaviour (the contract)

| Situation | Automation does | You are involved? |
|---|---|---|
| Alert fixable within current ranges (lockfile only) | Dependabot PR → CI (unit + e2e) → auto-approve → auto-merge. Alert closes. No release. | No |
| Alert needs a range bump in `packages/*/package.json` (ships to users) **and** every commit since the last release tag is a bot commit | Same as above, then **auto patch release** → publish → smoke-test published artifact | No |
| Alert needs a range bump but `main` also has unreleased human commits | Merge happens, no auto release (nothing half-finished ships). The next release you cut carries the fix. | No |
| Fix breaks CI on the PR | PR stays open, unmerged. Weekly sweeper closes stale failed Dependabot PRs. Dependabot re-opens when a newer fix version appears. | No |
| Fix needs a major bump / peer conflict (e.g. Nest 12) | Dependabot PR fails CI; handled as above. | No |
| Pre-publish gate fails (build/test/e2e on release) | No publish. Release is deleted/marked failed. Nothing changes for users. | No (a failed run is visible in Actions; optional silent status issue) |
| **Published version fails the smoke test** | 1) **roll forward**: re-publish the last good tag's code as the next version via OIDC (no secret), so `latest` and every caret range resolve to good code again, 2) mark the GitHub release as pre-release, 3) open an issue assigned to `@rinormaloku` labelled `release-broken` with the manual `npm deprecate` / `npm unpublish` commands, 4) pause automated releases while that issue is open | **Yes** — this is the only ping |

Same guard applies to your manual feature releases: a broken manual release also rolls back
and pings you.

## 3. Components

### 3.1 Repo hygiene (prerequisites)

No npm token or other secret is needed anywhere in this design.

- **Delete root `bun.lock`.** CI installs with `npm ci`; `bun test` runs against
  `node_modules` and does not read `bun.lock`. Keeping two lockfiles for one manifest is the
  root of the local-install ritual. Keep `e2e/bun.lock` (separate project, `bun install`).
- Merge the three green Dependabot PRs (#252, #254, #255). Close #253 with
  `@dependabot ignore this major version` — it needs NestJS 12, which is a feature decision.
- Enable repo setting `allow_auto_merge`.
- Change ruleset `protect-main`:
  - add **required status checks**: `test (20.x)`, `test (22.x)`, `test (24.x)`, plus the new
    `e2e` job (see 3.3). Auto-merge only fires when all required checks pass, so this is the
    safety gate.
  - keep "1 approving review" but let the workflow's approval satisfy it (`github-actions[bot]`
    review via `gh pr review --approve`). `require_last_push_approval` is satisfied because the
    last push is Dependabot's, not the approver's.
  - keep org-admin bypass so your own pushes to `main` keep working as today.

### 3.2 `.github/dependabot.yml` — security updates only, grouped, no noise

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: daily }
    open-pull-requests-limit: 0          # disables *version* updates; security updates still run
    groups:
      security:
        applies-to: security-updates
        patterns: ["*"]                  # one PR per batch instead of one per package
    labels: [dependencies, security]
  - package-ecosystem: npm
    directory: /e2e
    schedule: { interval: daily }
    open-pull-requests-limit: 0
    ignore:
      - dependency-name: "@modelcontextprotocol/sdk"   # intentionally pinned at 1.10.0 (backward-compat floor)
```

Note: grouping means one unfixable member (like #253) can drag a whole group red. If that
happens in practice, drop `groups` and fall back to per-package PRs; the sweeper (3.5) keeps
the red ones from piling up.

### 3.3 `pipeline.yml` — add an e2e job

Today PR CI runs unit tests only; e2e runs only at release time. For auto-merge to be safe the
PR must prove the examples still boot. Add a job:

```yaml
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4   # node 24
      - uses: oven-sh/setup-bun@v2
      - run: npm ci
      - run: npm run e2e:local        # ~2.5 min
```

Make it a required check. (It also protects your own PRs.)

### 3.4 `dependabot-automerge.yml`

```yaml
name: Dependabot auto-merge
on: pull_request
permissions: { contents: write, pull-requests: write }
jobs:
  automerge:
    if: github.actor == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: dependabot/fetch-metadata@v2
        id: md
      - run: gh pr review --approve "$PR"
      - run: gh pr merge --auto --squash "$PR"
        env: { PR: ${{ github.event.pull_request.html_url }}, GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

`--auto` waits for the required checks from 3.1; if any fails, nothing merges. Optional
guard: only auto-merge when `steps.md.outputs.update-type` is not `version-update:semver-major`
for packages that ship (`packages/*`).

### 3.5 `dependabot-sweeper.yml` (weekly, optional)

Closes Dependabot PRs whose checks have been red for > 7 days. Dependabot opens a new PR when a
newer patched version appears. This keeps the PR list clean without you.

### 3.6 `auto-release.yml` — release only when it matters

Trigger: **`schedule` every 6 hours** (plus `push` to `main` and `workflow_dispatch`). The
schedule is the real trigger: GitHub's auto-merge is armed by `dependabot-automerge.yml` with
`GITHUB_TOKEN`, and pushes made with that token never start workflows. The decision script is
idempotent, so polling is safe. Conditions (all must hold):
- **every** commit since the latest non-prerelease tag has author `dependabot[bot]` or
  `github-actions[bot]` (checked through the GitHub compare API, so squash-merge authorship is
  what counts). One human commit → no auto release; your next manual release carries the fix.
- the diff since that tag touches `packages/mcp-nest/package.json` or
  `packages/mcp-nest-auth/package.json`. Lockfile-only merges are skipped: the tarballs contain
  no lockfile, so a release would be byte-identical.
- `workflow_dispatch` with `force=true` skips both checks (manual patch release by you).

Steps:
1. Find latest non-prerelease tag (`v2.0.2`) → next patch (`v2.0.3`).
2. `gh release create v2.0.3 --generate-notes --target <sha>`.
3. Call the publish pipeline.

Important: a release created with `GITHUB_TOKEN` does **not** fire the `release: published`
event, so `publish.yml` must be refactored to also expose `workflow_call` with a `tag` input
(the `release` trigger keeps working for your manual releases). Everything else in
`publish.yml` (build → unit → e2e → version bump from tag → publish → smoke) stays as is.

Decision (2026-09-07): no half-finished features ship — hence the bot-only-commits rule.

### 3.7 Post-publish guard and rollback (the only place you get paged)

Two jobs after the existing `smoke-test` job in `publish.yml`, both only when a broken
version was actually published:

**`roll-forward`** (no secret). Checks out the tag the dist-tag pointed at before the publish
(`v<prev>`), runs `npm ci`, build and unit tests, publishes that code as the next version
(`semver -i patch`, or `-i prerelease` on the `next` tag) through OIDC, and creates the
matching tag + GitHub release so the tag list stays the source of truth. Users on a caret range
resolve to good code again within minutes. The broken version stays listed on npm.

**`rollback`** (GitHub only). Marks the broken GitHub release as pre-release with a banner and
opens an issue assigned to `rinormaloku`, label `release-broken`, containing: run URL, what the
roll-forward did, previous versions, and the exact manual commands (`npm deprecate`, or
`npm unpublish` inside 72 h; `npm dist-tag add` if the roll-forward itself failed).

Why no npm token: OIDC can only publish. A granular write token is capped at 90 days by npm,
so it would expire every quarter and silently disable the cleanup — the opposite of hands-off.
Decision (2026-09-07): registry cleanup of the broken version is a manual step, driven by the
issue.

**Pause rule.** `decide.sh` refuses to auto-release while an open `release-broken` issue
exists. Otherwise the next scheduled run would re-release the same broken `main` and burn
another version number every 6 hours. Closing the issue re-enables the automation.

### 3.8 Notifications

- GitHub notifies the assignee of a new issue → email/app ping. That is the single channel.
- Failed Dependabot PRs: mute via repo **Watch → Custom** (untick Pull requests) or rely on the
  sweeper. Auto-merged PRs generate no action for you.
- Failed pre-publish gates are visible in Actions only. Optional: one pinned issue
  `Automation status` that the workflows **edit in place** (edits do not notify).

## 4. Implementation order

1. Hygiene: delete `bun.lock`, merge #252/#254/#255, close #253. *(local + gh, ~10 min)*
2. Add `e2e` job to `pipeline.yml`; confirm ~3 min runtime on a PR.
3. Ruleset: required checks + keep admin bypass; enable `allow_auto_merge`. *(gh api, needs admin — you)*
4. Add `dependabot.yml`, `dependabot-automerge.yml`. Verify on the next Dependabot PR that it
   merges itself.
5. Refactor `publish.yml`: `workflow_call` input + pre-publish capture of previous `latest` +
   `roll-forward` and `rollback` jobs. No secret needed.
6. Add `auto-release.yml`.
7. Dry-run the rollback path once: publish a `v2.0.3-rc.0` pre-release with an intentionally
   broken smoke, confirm the roll-forward re-publishes the previous code as `2.0.3-rc.1` and
   an issue lands in your inbox. Close the issue.
8. Add `dependabot-sweeper.yml` (optional).

## 5. Out of scope, but noted

- **NestJS 12 support.** `@nestjs/*@12` exists; our peers say `>=9.0.0` for common/core but
  `^11.1.5` for `platform-fastify`. Users on Nest 12 + Fastify cannot install. That is a
  feature release, not a security patch — the automation will keep declining it correctly.
- `examples/*` are not published and have gitignored lockfiles; alerts there don't affect users.
- Coverage/Codecov step is unchanged.

## 6. Decisions (taken 2026-09-07)

1. Release only when all commits since the last tag are bot commits. Never ship WIP.
2. Rollback = dist-tag revert + unpublish (+ deprecate fallback) + issue.
3. No release on lockfile-only merges.

## 7. Status (2026-09-07) and what happens next

Implemented on branch `security-automation` (PR pending):

| File | Purpose |
|---|---|
| `.github/dependabot.yml` | security updates only, grouped, `/` and `/e2e`; old-client SDK pin ignored |
| `.github/workflows/pipeline.yml` | new required `e2e` job; per-PR concurrency |
| `.github/workflows/dependabot-automerge.yml` | approve + `gh pr merge --auto --squash`; refuses a major bump of a shipped range |
| `.github/workflows/dependabot-sweeper.yml` | Mondays: close Dependabot PRs red for > 7 days |
| `.github/workflows/auto-release.yml` | every 6 h: bot-only + shipped-range check → tag + release → call publish |
| `.github/workflows/publish.yml` | now also `workflow_call`; `resolve` job; `roll-forward` (OIDC re-publish of last good) + `rollback` (release banner + issue) jobs |
| `scripts/release/{next-version,decide,rollback}.sh` | testable pieces of the above (`DRY_RUN=1`, `COMPARE_JSON_FILE=`) |
| `scripts/release/admin-setup.sh` | the admin-only GitHub settings, idempotent |
| `bun.lock` (root) | deleted and gitignored |

### Needs the maintainer (admin / npm access)

1. `scripts/release/admin-setup.sh` — auto-merge on, Actions may approve PRs, required checks
   `test (20.x|22.x|24.x)` + `e2e` on the `protect-main` ruleset, `release-broken` label.
   Run it **after** this PR is merged (the `e2e` check only exists from then on).
2. Comment `@dependabot rebase` on #252, #254, #255. That fires `synchronize` and the new
   auto-merge workflow handles them — the first live test. Close #253 (needs NestJS 12).

### Verify once, then forget

- First Dependabot PR after setup: check it got an approval from `github-actions[bot]` and an
  "auto-merge enabled" badge, then merged on its own once `e2e` was green.
- Rollback rehearsal (plan step 7): create a pre-release `v2.0.3-rc.0` whose smoke is forced
  to fail, confirm the roll-forward publishes `2.0.3-rc.1` with the previous code on `next`,
  and an issue lands in your inbox. Then close the issue and check the next scheduled
  auto-release run says "paused" no more.

### Known limits

- CI on `main` (`pipeline.yml` push run, Codecov upload) does not run after an auto-merge, for
  the same token reason. PR checks are the gate, so nothing is lost except the coverage graph.
- A scheduled workflow is disabled by GitHub after 60 days without repository activity; bot
  merges count as activity, long quiet periods may still need a manual re-enable.
- `/e2e` has only `bun.lock`; Dependabot edits `e2e/package.json` ranges and the lockfile is
  regenerated by `bun install` at run time.
