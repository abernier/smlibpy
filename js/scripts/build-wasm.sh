#!/bin/sh
# Builds the WebAssembly module (js/wasm/smlibjs.mjs and smlibjs.wasm) from the repository root's
# CMake project with Emscripten. Needs the Emscripten SDK on the PATH (source emsdk_env.sh), or in
# ~/emsdk.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if ! command -v emcmake >/dev/null 2>&1; then
  . "${EMSDK:-$HOME/emsdk}/emsdk_env.sh" >/dev/null
fi
# (BUILD_DIR and OUT_DIR: a build of its own, for example next to another one)
BUILD_DIR="${BUILD_DIR:-$ROOT/build-wasm}"
OUT_DIR="${OUT_DIR:-$ROOT/js/wasm}"
emcmake cmake -S "$ROOT" -B "$BUILD_DIR" -G Ninja -DCMAKE_BUILD_TYPE=Release -DSMLIBJS_OUT_DIR="$OUT_DIR"
cmake --build "$BUILD_DIR"
ls -la "$OUT_DIR"
