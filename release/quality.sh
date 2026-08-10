#!/usr/bin/env bash
set -euo pipefail

: "${WISENT_SOURCE_DIR:?Stado must provide WISENT_SOURCE_DIR}"
: "${WISENT_PLATFORM:?Stado must provide WISENT_PLATFORM}"
: "${WISENT_INPUTS_DIR:?Stado must provide WISENT_INPUTS_DIR}"
[[ "$WISENT_PLATFORM" == "node-archive" ]]
node --check "$WISENT_SOURCE_DIR/src/index.mjs"
node --check "$WISENT_SOURCE_DIR/bin/weles-skarbiec-acquire.mjs"
