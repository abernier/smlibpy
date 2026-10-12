# AI agents (MCP)

smlibpy comes with an MCP server. An agent such as Claude writes Python scripts with smlibpy,
and the server runs them, shows the model in a live 3D viewer and renders pictures, so the
agent can check its work. If you ask for "a flange with six M8 holes on a 90 mm circle", the
agent builds the part, looks at it and saves a STEP file.

## Install

The server is part of the package, behind the `mcp` extra:

```bash
pip install "smlibpy[mcp]"
smlibpy-mcp            # speaks MCP over stdio; your agent host starts it
```

With [uv](https://docs.astral.sh/uv/) nothing has to be installed first:
`uvx --from "smlibpy[mcp]" smlibpy-mcp`.

### Claude Code

The plugin brings the server and a skill:

```bash
claude plugin marketplace add awv-informatik/smlibpy
claude plugin install smlibpy@smlibpy
```

Or add only the server:

```bash
claude mcp add smlibpy --scope user -- uvx --from "smlibpy[mcp]" smlibpy-mcp
```

### Claude desktop app, Cursor, VS Code and others

Every host takes the same command. In the JSON most of them use:

```json
{
  "mcpServers": {
    "smlibpy": { "command": "uvx", "args": ["--from", "smlibpy[mcp]", "smlibpy-mcp"] }
  }
}
```

That goes to `claude_desktop_config.json` (Claude desktop app), `~/.cursor/mcp.json` (Cursor)
or `.vscode/mcp.json` (VS Code, where the key is `servers` and each entry has
`"type": "stdio"`). Give the full path to `uvx` if the host does not find it.

## What the agent gets

| Tool | What it does |
|---|---|
| `run_script` | Runs Python with `from smlibpy import *`; variables stay between calls |
| `snapshot` | A PNG of the model: one view, or a sheet of front, left, top and iso view (ISO method E) |
| `scene`, `inspect` | What is shown, the variables, measurements of a shape, its faces and edges |
| `list_methods`, `describe_method`, `docs` | The API index, signatures and the guides of the skill |
| `save`, `load` | STEP, STL, glTF, OBJ, the native format, PNG; STEP and STL in |
| `checkpoint`, `restore`, `clear` | Go back to an earlier state, or start over |
| `view` | The link of the live viewer |

`show(a, b)` in a script chooses what the viewer and the pictures display; without it every
part and shell of the session is shown.

The server's instructions tell the agent how to work: plan, build in steps, check volume,
bounding box and validity after every step, look at the sheet of views, then deliver a STEP
file. The skill holds a guide for every API, written by agents that tested each call against
the kernel.

## How it runs

Scripts run in a separate process. A script that runs too long is stopped (after 120 s unless
the agent asks for more), and a crash of the kernel ends that process, not the server. Either
way the session is rebuilt by running the scripts that built it again, so nothing that worked
is lost. Checkpoints work the same way.

The viewer is a page on `127.0.0.1` that updates after every script. In the Claude desktop
app the agent opens it in its own browser pane; elsewhere it opens in your default browser.
Everything runs on your machine; the page loads three.js from a CDN.

| Variable | Effect |
|---|---|
| `SMLIBPY_VIEWER` | `host` (the agent opens the link), `browser` (your browser) or `off` |
| `SMLIBPY_SNAPSHOT_DIR` | Where pictures are kept (default: a folder in the temp directory) |

## With ClassCAD

If the ClassCAD MCP is installed as well, the agent can hand a part to the ClassCAD app
Buerligons: it saves a STEP file here and loads it there, where the part arrives as a solid.
