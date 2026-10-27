# smlibpy, smlibwasm and smlibpy-three 0.6.3

A patch release. Code written for 0.6.2 runs unchanged.

Everything applies to smlibpy (Python) and smlibwasm (JavaScript and TypeScript) alike, unless
marked *Python* or *smlibwasm*.

## New

- *Python*: **wheels for Python 3.15** (released on 9 October 2026), for Linux (x86_64, aarch64),
  macOS (arm64, x86_64) and Windows, as for Python 3.10 to 3.14. Until now pip built smlibpy from
  source on 3.15, which needs CMake and a C++17 compiler. CI tests 3.15 as its newest Python.
