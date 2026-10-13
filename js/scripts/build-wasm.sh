#!/bin/sh
# Builds the WebAssembly module (js/wasm/smlibjs.mjs and smlibjs.wasm) from the repository root's
# CMake project with Emscripten. Needs the Emscripten SDK on the PATH (source emsdk_env.sh), or in
# ~/emsdk.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if ! command -v emcmake >/dev/null 2>&1; then
  # (sourced from its own directory: under a plain sh, such as dash, it cannot find that itself)
  HERE="$(pwd)"
  cd "${EMSDK:-$HOME/emsdk}"
  . ./emsdk_env.sh >/dev/null
  cd "$HERE"
fi
# (BUILD_DIR and OUT_DIR: a build of its own, for example next to another one)
BUILD_DIR="${BUILD_DIR:-$ROOT/build-wasm}"
OUT_DIR="${OUT_DIR:-$ROOT/js/wasm}"
# (Ninja where there is one; a build directory keeps the generator it was made with)
GENERATOR=""
if [ ! -f "$BUILD_DIR/CMakeCache.txt" ] && command -v ninja >/dev/null 2>&1; then GENERATOR="-G Ninja"; fi
emcmake cmake -S "$ROOT" -B "$BUILD_DIR" $GENERATOR -DCMAKE_BUILD_TYPE=Release -DSMLIBJS_OUT_DIR="$OUT_DIR"
cmake --build "$BUILD_DIR" --parallel
ls -la "$OUT_DIR"
