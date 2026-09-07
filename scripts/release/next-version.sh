#!/usr/bin/env bash
#
# Print the next patch version tag, derived from the latest non-prerelease
# `v*` tag reachable in this clone.
#
#   v2.0.2  ->  v2.0.3
#
# Why tags and not package.json: `main` never carries the released version.
# `publish.yml` sets both packages' versions *from the tag* at publish time
# (`npm version "$TAG_VERSION" --no-git-tag-version -w ...`) and never commits
# the bump back. So packages/*/package.json on main is stale by design and the
# tag list is the only source of truth for "what was last released".
#
# Prerelease tags (anything containing `-`: v2.0.0-alpha.8, v1.9.10-alpha.4)
# are skipped -- a security patch release must build on the last real release,
# not on an alpha.
#
# Usage:
#   scripts/release/next-version.sh              # prints e.g. v2.0.3
#   BASE_TAG=$(... ) ...                          # see also --base
#
# Outputs (also written to $GITHUB_OUTPUT when set):
#   base_tag=v2.0.2
#   tag=v2.0.3
#
# Requires a clone with tags present (actions/checkout with fetch-depth: 0).

set -euo pipefail

# `--sort=-v:refname` orders by version semantics (so v2.0.10 > v2.0.9, which a
# lexical sort would get wrong). Then drop every prerelease and take the first.
base_tag=""
while IFS= read -r t; do
  case "$t" in
    *-*) continue ;; # prerelease (v2.0.0-alpha.8) -- not a release base
  esac
  base_tag="$t"
  break
done < <(git tag --list 'v*' --sort=-v:refname)

if [ -z "$base_tag" ]; then
  echo "next-version: no non-prerelease v* tag found in this repository." >&2
  echo "next-version: refusing to guess a starting version." >&2
  echo "next-version: (if this is a shallow clone, check out with fetch-depth: 0)" >&2
  exit 1
fi

# Strict vMAJOR.MINOR.PATCH. Anything else means the tag scheme changed and a
# human should look at it rather than have the bot invent a version.
if [[ ! "$base_tag" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "next-version: latest non-prerelease tag '$base_tag' is not vMAJOR.MINOR.PATCH." >&2
  exit 1
fi

major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"

next_tag="v${major}.${minor}.$((patch + 1))"

# A security patch is always a patch bump; if that tag somehow already exists
# (a race with a manual release, or a re-run after the tag was created) stop
# rather than have `gh release create` fail halfway through the pipeline.
if git rev-parse --verify --quiet "refs/tags/${next_tag}" >/dev/null; then
  echo "next-version: ${next_tag} already exists; refusing to reuse it." >&2
  exit 1
fi

echo "base_tag=${base_tag}"
echo "tag=${next_tag}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "base_tag=${base_tag}"
    echo "tag=${next_tag}"
  } >> "$GITHUB_OUTPUT"
fi
