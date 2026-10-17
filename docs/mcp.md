# AI agents (MCP)

smlibpy comes with an MCP server. An agent such as Claude writes Python scripts with smlibpy,
and the server runs them, shows the model live in Buerligons and renders pictures, so the
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
| `snapshot` | A PNG of the model: a view, a technical drawing (front, side and top view with hidden edges dashed, ISO method E or A), sheets of views, sections, highlighted selections, markers, x-ray, zebra stripes and curvature maps, and before/after comparisons |
| `scene`, `inspect` | What is shown, the variables, measurements of a shape, its faces and edges |
| `list_methods`, `describe_method`, `docs` | The API index, signatures and the guides of the skill |
| `save`, `load` | STEP, USD, STL, glTF, OBJ, the native format, PNG, DXF (sketches and sections); STEP, USD, STL and DXF in |
| `checkpoint`, `restore`, `clear` | Go back to an earlier state, or start over |
| `view` | The link of the live view (Buerligons) |
| `get_selection`, `set_selection` | What you selected in the live view, as expressions for scripts; faces and edges the agent highlights for you |

`show(a, b)` in a script chooses what the live view and the pictures display; without it every
part and shell of the session is shown.

The server's instructions tell the agent how to work: plan, build in steps, check volume,
bounding box and validity after every step, look at the drawing of the model, then deliver a
STEP file. The skill holds a guide for every API, written by agents that tested each call
against the kernel.

`snapshot` takes the options of `render` (see [Files](files.md#pictures)). Two work with the
session: `highlight` takes Python expressions such as `"part.edges().concave()"`, so an agent
can see what a selection picks before it fillets or cuts with it, and `section` takes an
expression such as `"Plane.XZ"` besides origin and normal. Every single view reports its frame;
a later snapshot with that `frame` and `compare=<path of the earlier picture>` reports the
pixels that changed and shows them in red.

## How it runs

Scripts run in a separate process. A script that runs too long is stopped (after 120 s unless
the agent asks for more), and a crash of the kernel ends that process, not the server. Either
way the session is rebuilt by running the scripts that built it again, so nothing that worked
is lost. Checkpoints work the same way.

## The live view

The live view is Buerligons, the ClassCAD app, served by the MCP server on `127.0.0.1` and
following every script. In the Claude desktop app the agent opens it in its own browser pane;
elsewhere it opens in your default browser. There you turn the model, select and measure
faces and edges, and save it as STEP, STL, glTF, OBJ, USD or SMLib's own format. Modeling stays
with the agent's scripts: the app opens in view mode.

What you select reaches the agent: ask "fillet the edges I selected" and `get_selection` gives
it each face, edge or vertex with its measurements and the expression that reaches it in a
script, such as `plate.faces()[6]`. The other way round, `set_selection` highlights what the
agent means ("is it this face?"). A selection lasts until the model changes: a face or an edge
is named by its place in the drawing, which the new model gives to whatever is there now, so
the app's selection is cleared with each change.

The app comes with smlibpy: Buerligons (the npm package `@buerli.io/buerligons`) in a small page,
built from `app/` in the repository when a release is built and shipped inside the package. Nothing
is downloaded, and it works offline.

| Variable | Effect |
|---|---|
| `SMLIBPY_VIEWER` | `host` (the agent opens the link), `browser` (your browser) or `off` |
| `SMLIBPY_APP_DIR` | A folder with the app to use instead of the one in the package |
| `SMLIBPY_SNAPSHOT_DIR` | Where pictures are kept (default: a folder in the temp directory) |

## smlibpy or ClassCAD

smlibpy suits results that a script produces once: parts written to STEP, STL or glTF,
variants from parameters, batch jobs and checks. The script is the model, and nothing else is
kept.

For models that have to stay editable and regenerate, the [ClassCAD MCP](https://classcad.ai)
is the right tool: sketches with constraints and dimensions, features that build on earlier
faces and edges, parts driven by expressions, assemblies with mates, and apps built around such
models with buerli or Buerligons. The smlibpy server tells the agent this, so it points you
there when you ask for that kind of model.

The two meet at STEP. If both MCPs are installed, the agent can hand a part to the ClassCAD app
Buerligons: it saves a STEP file here and loads it there, where the part arrives as a solid.
