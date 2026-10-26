"""usd-brep's Python module ``_omni_solid`` as smlibpy builds it: ``smlibpy._core`` holds the same
bindings (SmPyLib, without its OpenUSD part), under the name upstream's tests import."""

import sys

import smlibpy._core as _core

sys.modules[__name__] = _core
