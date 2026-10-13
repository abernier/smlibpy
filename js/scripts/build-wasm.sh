#!/bin/sh
# Builds the WebAssembly module (js/wasm/smlibjs.mjs and smlibjs.wasm) from the repository root's
# CMake project with Emscripten. Needs the Emscripten SDK on the PATH (source emsdk_env.sh), or in
# ~/emsdk.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if ! command -v emcmake >/dev/null 2>&1; then
  . "${EMSDK:-$HOME/emsdk}/emsdk_env.sh" >/dev/null
fi
emcmake cmake -S "$ROOT" -B "$ROOT/build-wasm" -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build "$ROOT/build-wasm"
ls -la "$ROOT/js/wasm"
