# Makes the module's loader (smlibwasm.mjs, written by Emscripten) bundle for the browser. Its Node
# branch loads node:module with a dynamic import whose name is a literal: webpack 5 cannot read
# it (UnhandledSchemeError), esbuild cannot resolve it for the browser, and Vite warns. Here the
# name is made at run time, and webpack and Vite are told to leave the import alone; Node, Deno and
# Bun load it as before. js/CMakeLists.txt runs this after every link:
#
#   cmake -DLOADER=<path of smlibwasm.mjs> -P patch-loader.cmake
file(READ "${LOADER}" text)
set(old "import(\"node:module\")")
set(new "import(/* webpackIgnore: true */ /* @vite-ignore */ [\"node\", \"module\"].join(\":\"))")
string(FIND "${text}" "${old}" at)
if(at GREATER -1)
  string(REPLACE "${old}" "${new}" text "${text}")
  file(WRITE "${LOADER}" "${text}")
endif()
# (an Emscripten that writes another such import: say so rather than ship a loader bundlers choke on)
string(FIND "${text}" "import(\"node:" left)
if(left GREATER -1)
  message(FATAL_ERROR "${LOADER} imports a node: module by a literal name, which bundlers for the browser cannot read: extend js/scripts/patch-loader.cmake")
endif()
