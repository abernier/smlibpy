# The JavaScript build: the kernel (smlib, sm_api from the parent) and its bindings for JavaScript
# as one WebAssembly module, built with Emscripten. Configured from the repository root:
#
#   emcmake cmake -S . -B build-wasm -G Ninja && cmake --build build-wasm
#
# Kernel objects cross into JavaScript as plain numbers (their address in the module's memory);
# the TypeScript layer (js/src) owns them and frees them. Kernel errors become JavaScript errors.

file(GLOB SMLIBWASM_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/cpp/*.cpp")
# smlibpy's own C++, shared with the Python extension (its Python bindings sit behind
# SMLIBPY_PYTHON, which is not defined here), and the kernel's error messages from SmPyLib
file(GLOB SMLIBPY_SHARED_SOURCES CONFIGURE_DEPENDS "${CMAKE_SOURCE_DIR}/src/cpp/*.cpp" "${CMAKE_SOURCE_DIR}/src/cpp/usd/*.cpp")
list(FILTER SMLIBPY_SHARED_SOURCES EXCLUDE REGEX ".*/module\\.cpp$")
set(SMPY_DIR "${USD_BREP_DIR}/source/SmPyLib/src")

add_executable(smlibwasm ${SMLIBWASM_SOURCES} ${SMLIBPY_SHARED_SOURCES} "${SMPY_DIR}/SmPyError.cpp")
target_include_directories(smlibwasm PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/cpp" "${CMAKE_SOURCE_DIR}/src/cpp"
                           "${CMAKE_SOURCE_DIR}/src/cpp/usd" "${SMPY_DIR}")
target_link_libraries(smlibwasm PRIVATE sm_api smlib)
# (a second build, in its own build directory, can write its module elsewhere)
set(SMLIBWASM_OUT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/wasm" CACHE PATH "Where the module (smlibwasm.mjs, smlibwasm.wasm) is written")
set_target_properties(smlibwasm PROPERTIES
  SUFFIX ".mjs"
  RUNTIME_OUTPUT_DIRECTORY "${SMLIBWASM_OUT_DIR}")

# (WebAssembly exceptions: set on the kernel targets by the parent, see there)
#
# The stack: a call that throws (a kernel error becomes a JavaScript exception) or traps leaves
# the stack pointer where it was inside the call, so js/src/kernel.ts saves it before every call
# and restores it when the call throws (stackSave, stackRestore). The stack lies below the static
# data (--stack-first), so that an overflow traps instead of overwriting that data.
target_link_options(smlibwasm PRIVATE
  -lembind
  -fwasm-exceptions
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createSmlib
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=64MB
  -sMAXIMUM_MEMORY=4GB
  -sSTACK_SIZE=4MB
  -Wl,--stack-first
  -sFILESYSTEM=1
  -sEXPORTED_RUNTIME_METHODS=FS,stackSave,stackRestore)
