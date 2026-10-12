# How to train

You are training the smlibpy skill: you write small Python scripts against smlibpy, run them,
look at the evidence and record what you learn. Your deliverable is **per-API documentation
for LLMs**, written to `src/smlibpy/skill/references/<domain>/<name>.md`. The journal is your
notebook. The docs are the point: the MCP server hands them to agents that build parts with
smlibpy, and an agent that reads your doc should get the call right the first time.

**Golden rule 1: everything is live.** You run real code against the real kernel. If a script
fails, find out why. If the docstring is wrong, say so. Nothing is theoretical.

**Golden rule 2: read before you write code.** Read the docstring and the user docs first. Do
not guess parameter names, defaults or return types.

**Pipeline: plan → read → script → run → journal → write the doc → changes.md → mark the plan**

All paths are relative to the repository root, `/Users/dev/dev/awv/buildsmlib`. Python is
`.venv/bin/python` (it imports the development build in `src/smlibpy`).

---

## Layout

```
src/smlibpy/                     the library (read only for you)
src/smlibpy/skill/
  SKILL.md                       overview of the skill (read it, do not edit it)
  references/<domain>/<name>.md  YOUR deliverable: one doc per API
  recipes/*.md                   workflows (read them, do not edit them)
docs/*.md                        the user documentation (source docs, read only)
ai/
  HOW-TO-TRAIN.md                this file
  run.py                         the harness
  plan/<domain>.md               the tasks of a domain, with checkboxes
  todo/<domain>.md               defects and surprises you found
  training/<YYYY-MM-DD_HH-MM-SS>_<domain>-<topic>/
    scripts/                     your test scripts (one question per file)
    files/                       harness output (PNG, STEP, JSON, logs)
    journal.md                   your log
    changes.md                   the diff of your docs
```

**Source docs (read only):** the docstrings (`.venv/bin/python -c "import smlibpy; help(smlibpy.Box)"`),
`docs/*.md`, and the code in `src/smlibpy/*.py` when the docstring leaves a question open.
**LLM docs (yours):** `src/smlibpy/skill/references/<domain>/*.md`.

## Working next to other trainers

Several trainers work at the same time, one per domain. You own exactly:

- `ai/plan/<your domain>.md` and `ai/todo/<your domain>.md`
- your session folders under `ai/training/`
- `src/smlibpy/skill/references/<your domain>/`

Do not edit anything else: not the library, not the tests, not `docs/`, not another domain's
files, not `SKILL.md`. Do not run git commands that change state (no commit, stash, checkout,
reset); `git diff` and `git status` are fine. If you find a defect in smlibpy, write it to your
TODO file with a minimal script that shows it, and document the current behaviour in the doc
as a gotcha. The maintainer fixes the library and commits everything.

---

## The harness

```bash
.venv/bin/python ai/run.py ai/training/<session>/scripts/01-basic.py --outdir ai/training/<session>
```

The script is plain Python with `from smlibpy import *`, `math` and `numpy as np` already
imported, plus two helpers:

- `snapshot(label, *shapes, view="iso", size=(900, 675))`: renders the shapes (default: every
  Part and Shell variable of the script) to `files/<script>-<label>.png`; parts and shells also
  go to `files/<script>-<label>.step`. `view` is `iso`, `front`, `back`, `left`, `right`,
  `top`, `bottom`, `sheet` (front, top, right and iso at one scale) or a direction `(x, y, z)`
  from the model towards the camera.
- `filewrite(data, label)`: dicts and lists to `.json`, strings to `.txt`, bytes to `.bin`.

Everything the script prints goes to `files/<script>.log` as well. A script that raises prints
the failing line and the error and exits with 1.

Keep printed lines short and flat: `print("[03] volume:", round(p.volume, 3))`. Large data goes
to `filewrite`.

**Pictures are scaled to fit.** A box twice as big looks the same. Use them for shape, topology
and placement relative to other bodies; prove sizes, positions and directions with numbers
(`bbox()`, `center()`, `volume`, `normal_at()`, coordinates of vertices). When a picture and
the numbers disagree, you measured the wrong thing: investigate before you write anything down.
Add a small fixed reference body when a size change should be visible. `view="sheet"` shows
four views at one scale and settles most questions about placement.

---

## Step 1 — your tasks

Open `ai/plan/<your domain>.md`. Work through the rows in order. Each row names the doc file to
write and what it must cover. Do them all; depth over speed. If a row turns out to be two
topics, write two docs and note it in the plan.

## Step 2 — read

For each task: the docstring, the user docs that mention it (`grep -rn "<name>" docs/`), and the
code. Write down the parameters, defaults and return type you expect, and the questions you
want answered.

## Step 3 — session folder and journal

Create `ai/training/<YYYY-MM-DD_HH-MM-SS>_<domain>-<topic>/` with `scripts/` and `files/`, and
`journal.md`:

```markdown
# Training: <domain> · <topic>

**Date:** YYYY-MM-DD

## Goal

APIs: `Box`, `Cylinder`, ...

Questions:
- Where does a Box sit by default? What does align change?
- What happens with zero or negative sizes?
```

A session can cover several tasks of your plan.

## Step 4 — write, run, journal

Each script tests one parameter, variant or question. Name them `01-default.py`,
`02-align.py`, ... Progression: the happy path → each parameter → combinations → edge cases →
errors → realistic use together with the APIs it is used with.

After each run, add an entry to the journal: the script, the result in one line, the evidence
(numbers from the log or a JSON file, and the picture as `![label](files/<file>.png)` when there
is one). Mark findings that belong in the doc with **📌 doc:**.

Coverage, checked after every five scripts and at the end of a task:

- [ ] the API ran successfully at least once
- [ ] every parameter was tried; every enum value or mode was tried
- [ ] defaults verified by measurement, not taken from the docstring
- [ ] edge cases and error cases tried: what is raised, with what message
- [ ] at least one realistic use with the APIs it is combined with
- [ ] every spatial claim (origin, alignment, direction, size) backed by numbers
- [ ] every question of the goal answered by a named script

Stop a task after about 20 scripts; note the gaps. A method that fails three times with
different inputs is a finding: write it down and go on.

## Step 5 — write the doc

`src/smlibpy/skill/references/<domain>/<name>.md`. The file name is the API's name (`Box.md`,
`fillet.md`, `filter_by.md`); a concept that spans several APIs goes to `generic.md` or a name
the plan gives.

Write for an LLM that is about to use the API. Direct, concise, opinionated. Do not repeat the
docstring; add what the docstring does not say. No dates, no "verified on", no history: when a
statement turns out wrong, replace it. Every code example must have run in one of your
scripts, unchanged.

```markdown
# Box

One line: what it makes.

## Signature
`Box(length, width, height, *, align=(Align.CENTER, Align.CENTER, Align.CENTER))`
What each parameter means, where it is not obvious. Units: mm, degrees.

## Returns
A `Part`, centered on the origin by default (bbox −l/2..l/2 ...).

## Gotchas
- What surprised you, what fails silently, what is easy to get wrong.

## Errors
- `ModelingError: ...` when ...; the fix.

## Example
```python
...  # ran in scripts/03-realistic.py
```

## Related
`Cylinder`, `Part.fillet`, ...
```

Keep it short: most docs are 30 to 80 lines. A long doc is fine when the API is rich (selection,
fillets).

## Step 6 — changes.md

Record the diff of every doc you created or changed in `ai/training/<session>/changes.md`:

```bash
f=src/smlibpy/skill/references/<domain>/<name>.md
if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then git diff -- "$f"; else git diff --no-index /dev/null "$f"; fi >> ai/training/<session>/changes.md
```

`git diff --no-index` exits with 1 when there are differences; that is expected. These commands
do not touch the git index (other trainers work at the same time). Do not commit.

## Step 7 — mark the plan

In `ai/plan/<domain>.md`, change the row's `[ ]` to `[x]` and add the doc file name.

## Step 8 — defects and surprises

Append to `ai/todo/<domain>.md`, under HIGH / MEDIUM / LOW:

```markdown
### N. `<api>`: short title
- **Session:** `<folder>`, script `NN-name.py`
- **What happens:** the error or behaviour
- **Expected:** what the docs say or what makes sense
- **Reproduce:** the smallest script
- **Workaround:** if there is one
```

Defects in the kernel or the library, wrong docstrings, silent wrong results, crashes and hangs
all belong here. A crash of the Python process (segmentation fault) is HIGH; run the smallest
reproduction once more to be sure it is not random.

## When you are done

Report back: the docs you wrote (paths), the plan rows done, the defects you found (one line
each, with severity), and anything in the API that confused you as a user.
