"""The part of OpenUSD's ``pxr`` that NVIDIA's BrepArray validator reads (tools/oracles/usd_validator.py):
a stage of one ``.usda`` layer, its prims, attributes, relationships and applied schemas, and the
attributes the omniSolid schema defines. No composition (references, sublayers, variants): smlibpy
writes single layers."""

from . import Sdf, Usd  # noqa: F401
