cmake_minimum_required(VERSION 3.20)
project(smlibpy LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# (the Python extension is a shared module; the WebAssembly module links statically)
if(NOT EMSCRIPTEN)
  set(CMAKE_POSITION_INDEPENDENT_CODE ON)
endif()
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# NVIDIA's open-source SMLib distribution (Apache-2.0), pulled in as a submodule.
set(USD_BREP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/usd-brep" CACHE PATH "usd-brep checkout")
if(NOT EXISTS "${USD_BREP_DIR}/source/SMLib/src/SmBrep.cpp")
  message(FATAL_ERROR "usd-brep sources not found in ${USD_BREP_DIR}. Run: git submodule update --init")
endif()

# The kernel is single threaded unless TBB is found. TBB parallelises tessellation and
# Boolean pre-processing only, so it is optional.
option(SMLIBPY_USE_TBB "Use oneTBB for the parallel parts of the kernel" OFF)

# Patched copies of a few kernel sources are compiled in place of the originals:
# third_party/patches/<dir>/src/<file> replaces source/<dir>/src/<file> of usd-brep, and
# third_party/patches/<dir>/inc/<file> is included instead of source/<dir>/inc/<file>. What each
# one fixes, and how to drop it, is in third_party/patches/README.md.
set(SMLIBPY_PATCH_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/patches")
function(smlibpy_patch_sources sources_var dir)
  file(GLOB patched CONFIGURE_DEPENDS "${SMLIBPY_PATCH_DIR}/${dir}/src/*.cpp")
  set(sources ${${sources_var}})
  foreach(file ${patched})
    get_filename_component(name "${file}" NAME)
    string(REPLACE "." "\\." pattern "/${name}$")
    list(LENGTH sources before)
    list(FILTER sources EXCLUDE REGEX "${pattern}")
    list(LENGTH sources after)
    math(EXPR removed "${before} - ${after}")
    if(NOT removed EQUAL 1)
      message(FATAL_ERROR "${file} must replace exactly one kernel source source/${dir}/src/${name}")
    endif()
    list(APPEND sources "${file}")
  endforeach()
  set(${sources_var} ${sources} PARENT_SCOPE)
endfunction()
# Patched copies of kernel headers: third_party/patches/<dir>/inc/<file> is found before
# source/<dir>/inc/<file> by every file that includes it, the kernel's, SmPyLib's and smlibpy's
# (the directory comes first in the include path of the target and of everything that links it).
function(smlibpy_patch_headers target dir)
  file(GLOB patched CONFIGURE_DEPENDS "${SMLIBPY_PATCH_DIR}/${dir}/inc/*.h")
  foreach(file ${patched})
    get_filename_component(name "${file}" NAME)
    if(NOT EXISTS "${USD_BREP_DIR}/source/${dir}/inc/${name}")
      message(FATAL_ERROR "${file} must replace a kernel header source/${dir}/inc/${name}")
    endif()
  endforeach()
  if(patched)
    target_include_directories(${target} BEFORE PUBLIC "${SMLIBPY_PATCH_DIR}/${dir}/inc")
  endif()
endfunction()

# ---------------------------------------------------------------------------
# Kernel (SMLib) and its C-style wrapper (SM_API), both static so the Python
# extension is a single self-contained module.
# ---------------------------------------------------------------------------
# The kernel does not depend on the Python version. Release builds compile it once per
# platform (SMLIBPY_KERNEL_ONLY) and link every wheel against that build (SMLIBPY_KERNEL_DIR,
# usually from the environment); see .github/workflows/release.yml.
option(SMLIBPY_KERNEL_ONLY "Compile only the kernel libraries smlib and sm_api" OFF)
set(SMLIBPY_KERNEL_DIR "$ENV{SMLIBPY_KERNEL_DIR}" CACHE PATH "Build directory of a kernel compiled with SMLIBPY_KERNEL_ONLY")

if(SMLIBPY_KERNEL_DIR AND NOT SMLIBPY_KERNEL_ONLY)
  include("${SMLIBPY_KERNEL_DIR}/smlibpy-kernel.cmake")
else()
  file(GLOB SMLIB_SOURCES CONFIGURE_DEPENDS "${USD_BREP_DIR}/source/SMLib/src/*.cpp")
  smlibpy_patch_sources(SMLIB_SOURCES SMLib)
  add_library(smlib STATIC ${SMLIB_SOURCES})
  target_include_directories(smlib PUBLIC "${USD_BREP_DIR}/source/SMLib/inc")
  smlibpy_patch_headers(smlib SMLib)
  # Same defines as the upstream release configuration (premake5.lua).
  target_compile_definitions(smlib PUBLIC NOMINMAX SM_GRAPHICS_CALLBACKS=1 $<$<CONFIG:Release,RelWithDebInfo,MinSizeRel>:NDEBUG>)

  if(SMLIBPY_USE_TBB)
    find_package(TBB REQUIRED)
    target_compile_definitions(smlib PUBLIC SM_USE_TBB TBB_SUPPRESS_DEPRECATED_MESSAGES)
    target_link_libraries(smlib PUBLIC TBB::tbb)
  endif()

  file(GLOB SM_API_SOURCES CONFIGURE_DEPENDS "${USD_BREP_DIR}/source/SM_API/src/*.cpp")
  smlibpy_patch_sources(SM_API_SOURCES SM_API)
  add_library(sm_api STATIC ${SM_API_SOURCES})
  target_include_directories(sm_api PUBLIC "${USD_BREP_DIR}/source/SM_API/inc")
  smlibpy_patch_headers(sm_api SM_API)
  # PUBLIC: everything is linked statically into one module, so consumers must not see
  # __declspec(dllimport) declarations on Windows.
  target_compile_definitions(sm_api PUBLIC SM_API_EXPORTS)
  target_link_libraries(sm_api PUBLIC smlib)

  if(MSVC)
    foreach(t smlib sm_api)
      target_compile_options(${t} PRIVATE /utf-8 /bigobj /wd4244 /wd4305 /wd4267 /W1)
      # The Visual Studio generator compiles the files of a target one after another
      # unless told otherwise; the kernel alone has more than 200 large sources.
      if(CMAKE_GENERATOR MATCHES "Visual Studio")
        target_compile_options(${t} PRIVATE /MP)
      endif()
    endforeach()
  else()
    foreach(t smlib sm_api)
      # Vendor code: keep the build quiet, upstream enforces its own warning policy.
      target_compile_options(${t} PRIVATE -w)
    endforeach()
  endif()
  if(EMSCRIPTEN)
    # The kernel throws in a few places and never catches: with WebAssembly exceptions a
    # binding turns such a throw into a JavaScript error instead of ending the module.
    foreach(t smlib sm_api)
      target_compile_options(${t} PUBLIC -fwasm-exceptions)
    endforeach()
  endif()
  if(SMLIBPY_KERNEL_ONLY)
    export(TARGETS smlib sm_api FILE "${CMAKE_BINARY_DIR}/smlibpy-kernel.cmake")
    return()
  endif()
endif()

# Upstream's kernel tests against this kernel (tools/oracles/prog_test.py runs them).
option(SMLIBPY_PROG_TEST "Build usd-brep's prog_test_app against the patched kernel" OFF)
if(SMLIBPY_PROG_TEST AND NOT EMSCRIPTEN)
  include("${CMAKE_CURRENT_SOURCE_DIR}/tools/oracles/prog_test.cmake")
endif()

# ---------------------------------------------------------------------------
# WebAssembly (Emscripten): the JavaScript module of js/ instead of the Python extension.
# ---------------------------------------------------------------------------
if(EMSCRIPTEN)
  add_subdirectory(js)
  return()
endif()

# ---------------------------------------------------------------------------
# Python extension: upstream pybind11 bindings (without USD) + our additions.
# ---------------------------------------------------------------------------
find_package(Python 3.10 REQUIRED COMPONENTS Interpreter Development.Module)
find_package(pybind11 CONFIG REQUIRED)

file(GLOB SMPY_SOURCES CONFIGURE_DEPENDS "${USD_BREP_DIR}/source/SmPyLib/src/*.cpp")
# SmPyMain.cpp declares the module `_omni_solid`; we provide our own spine (src/cpp/module.cpp)
# with the same binder calls. SmPyUsd.cpp needs OpenUSD, which we do not depend on.
list(FILTER SMPY_SOURCES EXCLUDE REGEX ".*/SmPy(Main|Usd)\\.cpp$")
# (src/cpp/usd: the BrepArray conversion of usd-brep, without OpenUSD; see src/cpp/usd/pxr_lite.h.
# src/cpp/occt: usd-brep's bridge to OpenCASCADE's .brep files, see src/cpp/occt/README.md)
file(GLOB SMLIBPY_CPP_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/cpp/*.cpp"
     "${CMAKE_CURRENT_SOURCE_DIR}/src/cpp/usd/*.cpp")
file(GLOB SMLIBPY_OCCT_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/cpp/occt/*.cpp")
list(APPEND SMLIBPY_CPP_SOURCES ${SMLIBPY_OCCT_SOURCES})

pybind11_add_module(_core MODULE ${SMPY_SOURCES} ${SMLIBPY_CPP_SOURCES})
target_include_directories(_core PRIVATE
  "${USD_BREP_DIR}/source/SmPyLib/src"
  "${CMAKE_CURRENT_SOURCE_DIR}/src/cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/src/cpp/usd"
  "${CMAKE_CURRENT_SOURCE_DIR}/src/cpp/occt")
target_link_libraries(_core PRIVATE sm_api smlib)
# smlibpy's own C++ (src/cpp) is shared with the JavaScript module: its Python bindings sit
# behind SMLIBPY_PYTHON.
target_compile_definitions(_core PRIVATE SMLIBPY_PYTHON)
if(MSVC)
  # (M_PI and the other constants of math.h: MSVC defines them only on request. The usd-brep
  # classes of src/cpp/occt are compiled into this module: their USD_BREP_EXPORT is dllexport here,
  # not dllimport, which looked for them in a usd-brep DLL and left 18 symbols unresolved.)
  target_compile_definitions(_core PRIVATE _USE_MATH_DEFINES USD_BREP_ENABLE_EXPORTS)
  target_compile_options(_core PRIVATE /utf-8 /bigobj /wd4244 /wd4305 /wd4267)
  if(CMAKE_GENERATOR MATCHES "Visual Studio")
    target_compile_options(_core PRIVATE /MP)
  endif()
else()
  target_compile_options(_core PRIVATE -Wno-deprecated-declarations)
  # (vendor code, as the kernel: upstream keeps its own warning policy)
  set_source_files_properties(${SMLIBPY_OCCT_SOURCES} PROPERTIES COMPILE_OPTIONS -w)
endif()

install(TARGETS _core LIBRARY DESTINATION smlibpy RUNTIME DESTINATION smlibpy)

# Development layout: without scikit-build, put the module next to the Python sources so that
# `src/` on sys.path imports the freshly built package.
if(NOT SKBUILD)
  set_target_properties(_core PROPERTIES LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/src/smlibpy")
endif()
