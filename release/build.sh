#!/usr/bin/env bash
set -euo pipefail

: "${WISENT_VERSION:?Stado must provide WISENT_VERSION}"
: "${WISENT_SOURCE_DIR:?Stado must provide WISENT_SOURCE_DIR}"
: "${WISENT_OUTPUT_DIR:?Stado must provide WISENT_OUTPUT_DIR}"
: "${WISENT_PLATFORM:?Stado must provide WISENT_PLATFORM}"
: "${WISENT_INPUTS_DIR:?Stado must provide WISENT_INPUTS_DIR}"
[[ "$WISENT_PLATFORM" == "node-archive" ]]

work="$WISENT_OUTPUT_DIR/work"
dist="$WISENT_OUTPUT_DIR/dist"
# Throwaway state is removed by the code that made it: the packed archive and
# the npm cache end with the run once dist holds the copy.
trap 'rm -rf "$work"' EXIT
mkdir -p "$work" "$dist"
archive="$(npm_config_cache="$work/npm-cache" npm pack "$WISENT_SOURCE_DIR" --silent --pack-destination "$work")"
[[ -f "$work/$archive" ]]
cp "$work/$archive" "$dist/weles-client.tgz"
(
  cd "$dist"
  shasum -a 256 weles-client.tgz > weles-client.tgz.sha256
)
if [[ -n "${WISENT_SOURCE_COMMIT:-}" ]]; then
  printf '%s\n' "$WISENT_SOURCE_COMMIT" > "$dist/SOURCE_REVISION"
else
  git -C "$WISENT_SOURCE_DIR" rev-parse HEAD > "$dist/SOURCE_REVISION"
fi
