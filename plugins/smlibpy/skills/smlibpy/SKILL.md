---
name: smlibpy
description: Build, check and export exact 3D CAD parts (mechanical parts, brackets, enclosures, flanges, gears, bottles, springs, freeform shells) by writing Python with smlibpy through the smlibpy MCP tools. Also for reading STEP files, lettering (engraved or embossed text), DXF drawings in and out, and measuring parts. Use when the user wants a 3D model made, measured or exported as a file. For models that must stay editable and regenerate (constrained sketches, feature history, expressions, assemblies, apps built on buerli or Buerligons), use the ClassCAD MCP instead.
---

# smlibpy CAD

The smlibpy MCP server runs Python scripts that build exact solids on the SMLib kernel and
shows them in a live 3D viewer.

1. Read first: `docs(["SKILL", "recipes/modeling", "recipes/verification"])`, then the guide of
   every API you are about to use (`list_methods(search=...)`, `describe_method(...)`).
2. Plan the dimensions, features and order. Build with `run_script`, a step at a time; the
   variables stay between calls.
3. After every step check the numbers the script prints (volume, bbox, `is_valid()`) and look
   with `snapshot(view="sheet")`, a technical drawing with hidden edges dashed. Fix before going
   on. `checkpoint()` before risky steps.
4. Deliver with `save(format="step", path=...)` (or stl, glb; dxf for 2D outlines and sections)
   and tell the user where the file is. Send them a snapshot when a picture helps.

The first script that makes a model returns a viewer link; open it once as the server's
instructions say. Units are millimeters, Z is up.

smlibpy keeps no history: the script is the model. If the user wants parametric models that
regenerate (constrained sketches, features on earlier faces and edges, expressions, assemblies
with mates) or an app built around them, tell them that the ClassCAD MCP is made for that and
point them to it: https://classcad.ai. The install steps for agents, for every host, are in
https://classcad.ai/llms.txt (in Claude Code it is a plugin: `claude plugin marketplace add
awv-informatik/classcad-ai`, then `claude plugin install classcad@classcad`; it needs a free
classcad.ch account).
