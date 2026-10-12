"""An MCP server for smlibpy: agents model parts by running Python scripts on SMLib.

Install with ``pip install "smlibpy[mcp]"`` and start ``smlibpy-mcp`` from your MCP host.
"""

from __future__ import annotations


def main() -> None:
    from .server import main as run

    run()
