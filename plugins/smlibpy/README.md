# smlibpy plugin for Claude Code

Adds the smlibpy MCP server and a skill to Claude Code. Claude models parts by writing Python
with [smlibpy](https://github.com/awv-informatik/smlibpy), checks them with numbers and
pictures, shows them live in Buerligons (the ClassCAD app) on your machine and saves STEP, STL, glTF or DXF files.

```bash
claude plugin marketplace add awv-informatik/smlibpy
claude plugin install smlibpy@smlibpy
```

The server is started with [uv](https://docs.astral.sh/uv/) (`uvx`), which installs smlibpy
from PyPI into its own environment the first time. Everything runs locally: the kernel, the
scripts and the live view (Buerligons on 127.0.0.1; the app is downloaded from npm once and cached).
