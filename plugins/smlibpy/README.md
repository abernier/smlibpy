# smlibpy plugin for Claude Code

Adds the smlibpy MCP server and a skill to Claude Code. Claude models parts by writing Python
with [smlibpy](https://github.com/awv-informatik/smlibpy), checks them with numbers and
pictures, shows them in a live 3D viewer on your machine and saves STEP, STL or glTF files.

```bash
claude plugin marketplace add awv-informatik/smlibpy
claude plugin install smlibpy@smlibpy
```

The server is started with [uv](https://docs.astral.sh/uv/) (`uvx`), which installs smlibpy
from PyPI into its own environment the first time. Everything runs locally: the kernel, the
scripts and the viewer (on 127.0.0.1). The viewer page loads three.js from a CDN.
