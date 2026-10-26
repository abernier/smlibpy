# Upstream's kernel tests (usd-brep tests/prog_test: 17 suites, about 20 s), built against the
# kernel as smlibpy builds it, with the patches of third_party/patches. Configure with
# -DSMLIBPY_PROG_TEST=ON; tools/oracles/prog_test.py runs the suites.
file(GLOB SMLIBPY_PROG_TEST_SOURCES CONFIGURE_DEPENDS "${USD_BREP_DIR}/tests/prog_test/src/*.cpp")
add_executable(prog_test_app ${SMLIBPY_PROG_TEST_SOURCES})
target_include_directories(prog_test_app PRIVATE "${USD_BREP_DIR}/tests/prog_test/inc")
target_link_libraries(prog_test_app PRIVATE smlib)
find_package(Threads)
if(Threads_FOUND)
  target_link_libraries(prog_test_app PRIVATE Threads::Threads)
endif()
if(MSVC)
  target_compile_definitions(prog_test_app PRIVATE _CRT_SECURE_NO_WARNINGS)
  target_compile_options(prog_test_app PRIVATE /utf-8 /bigobj /W1)
else()
  target_compile_options(prog_test_app PRIVATE -w)
endif()
