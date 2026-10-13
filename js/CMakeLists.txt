# The JavaScript build: the kernel (smlib, sm_api from the parent) and its bindings for JavaScript
# as one WebAssembly module, built with Emscripten. Configured from the repository root:
#
#   emcmake cmake -S . -B build-wasm -G Ninja && cmake --build build-wasm
#
# Kernel objects cross into JavaScript as plain numbers (their address in the module's memory);
# the TypeScript layer (js/src) owns them and frees them. Kernel errors become JavaScript errors.

file(GLOB SMLIBJS_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/cpp/*.cpp")

add_executable(smlibjs ${SMLIBJS_SOURCES})
target_include_directories(smlibjs PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/cpp")
target_link_libraries(smlibjs PRIVATE sm_api smlib)
set_target_properties(smlibjs PROPERTIES
  SUFFIX ".mjs"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/wasm")

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
