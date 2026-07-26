#!/usr/bin/env bash
#
# Point every example at either the local workspace packages or a published
# version of @rekog/mcp-nest[-auth].
#
#   scripts/use-examples.sh local               # → file:../../packages/*  (in-flight local build)
#   scripts/use-examples.sh published            # → "latest" dist-tag
#   scripts/use-examples.sh published next        # → "next" dist-tag (pre-releases)
#   scripts/use-examples.sh published 2.0.0-alpha.4  # → an exact version
#
# Only dependencies an example already declares are rewritten, so auth-free
# examples never gain @rekog/mcp-nest-auth. Nested projects (e.g. the
# perf-benchmark v1-baseline) are left untouched.
#
# In `local` mode, build the workspace first so dist/ exists:
#   bun run build
# Then, in whichever example you're testing: `npm install` (or `bun install`).
set -euo pipefail

MODE=${1:-}
VERSION=${2:-latest}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "$MODE" in
  local)
    CORE="file:../../packages/mcp-nest"
    AUTH="file:../../packages/mcp-nest-auth"
    ;;
  published)
    CORE="$VERSION"
    AUTH="$VERSION"
    ;;
  *)
    echo "usage: $(basename "$0") <local|published> [version|dist-tag]" >&2
    exit 1
    ;;
esac

for pkg in "$ROOT"/examples/*/package.json; do
  [ -f "$pkg" ] || continue
  dir="$(dirname "$pkg")"
  (
    cd "$dir"
    changed=0
    for name in @rekog/mcp-nest @rekog/mcp-nest-auth; do
      # Skip deps this example doesn't declare (npm pkg get prints {} when absent).
      [ "$(npm pkg get "dependencies.$name")" = "{}" ] && continue
      case "$name" in
        @rekog/mcp-nest) val="$CORE" ;;
        @rekog/mcp-nest-auth) val="$AUTH" ;;
      esac
      npm pkg set "dependencies.$name=$val"
      changed=1
      echo "  $(basename "$dir"): $name -> $val"
    done

    # Drop the lockfile whenever we retarget a @rekog dep.
    #
    # This is load-bearing, not tidiness. A lockfile written in PUBLISHED mode
    # records a registry resolution for @rekog/mcp-nest, and npm honours that
    # entry over the `file:` spec we just wrote into package.json — so `local`
    # mode would flip package.json while every install silently kept serving
    # the published tarball, and tests would quietly stop exercising the local
    # build. Lockfiles here are gitignored, so regenerating them costs nothing.
    if [ "$changed" = "1" ] && [ -f package-lock.json ]; then
      rm -f package-lock.json
    fi
  )
done

echo
echo "Done ($MODE). Run 'npm install' (or 'bun install') in an example to apply."
echo "Lockfiles were dropped so the new source actually wins; they are gitignored."
if [ "$MODE" = "local" ]; then
  echo "Reminder: 'bun run build' first so packages/*/dist exists."
  echo "Note: npm 9 defaults install-links=true, which COPIES a file: dep instead"
  echo "      of symlinking it — so a rebuild needs a reinstall to take effect."
  echo "      Use 'npm install --install-links=false' to get a symlink instead."
fi
