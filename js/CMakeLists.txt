# The JavaScript build: the kernel (smlib, sm_api from the parent) and its bindings for JavaScript
# as one WebAssembly module, built with Emscripten. Configured from the repository root:
#
#   emcmake cmake -S . -B build-wasm -G Ninja && cmake --build build-wasm
#
# Kernel objects cross into JavaScript as plain numbers (their address in the module's memory);
# the TypeScript layer (js/src) owns them and frees them. Kernel errors become JavaScript errors.

file(GLOB SMLIBJS_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/cpp/*.cpp")
# smlibpy's own C++, shared with the Python extension (its Python bindings sit behind
# SMLIBPY_PYTHON, which is not defined here), and the kernel's error messages from SmPyLib
file(GLOB SMLIBPY_SHARED_SOURCES CONFIGURE_DEPENDS "${CMAKE_SOURCE_DIR}/src/cpp/*.cpp")
list(FILTER SMLIBPY_SHARED_SOURCES EXCLUDE REGEX ".*/module\\.cpp$")
set(SMPY_DIR "${USD_BREP_DIR}/source/SmPyLib/src")

add_executable(smlibjs ${SMLIBJS_SOURCES} ${SMLIBPY_SHARED_SOURCES} "${SMPY_DIR}/SmPyError.cpp")
target_include_directories(smlibjs PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/cpp" "${CMAKE_SOURCE_DIR}/src/cpp" "${SMPY_DIR}")
target_link_libraries(smlibjs PRIVATE sm_api smlib)
# (a second build, in its own build directory, can write its module elsewhere)
set(SMLIBJS_OUT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/wasm" CACHE PATH "Where the module (smlibjs.mjs, smlibjs.wasm) is written")
set_target_properties(smlibjs PROPERTIES
  SUFFIX ".mjs"
  RUNTIME_OUTPUT_DIRECTORY "${SMLIBJS_OUT_DIR}")

# (WebAssembly exceptions: set on the kernel targets by the parent, see there)
target_link_options(smlibjs PRIVATE
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
  -sFILESYSTEM=1
  -sEXPORTED_RUNTIME_METHODS=FS)
