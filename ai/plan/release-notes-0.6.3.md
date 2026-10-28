# smlibpy, smlibwasm and smlibpy-three 0.6.3

A patch release. Code written for 0.6.2 runs unchanged.

Everything applies to smlibpy (Python) and smlibwasm (JavaScript and TypeScript) alike, unless
marked *Python*, *smlibwasm* or *smlibpy-three*.

## Changed

- *Python*: the `test` and `docs` extras are ranges again, as before 0.6.2 (pytest 8 or later,
  websockets 13 or later; mkdocs-material 9.5 and mkdocstrings 0.26 or later). CI and the release
  build pin every package they install from PyPI in `uv.lock` instead, for every Python and
  platform, and Dependabot raises the lock once a week.
