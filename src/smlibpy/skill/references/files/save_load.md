# save / load

`save` writes one body to SMLib's native `.smb` format. `load` reads `.smb`, STEP and STL,
and picks the format from the extension.

## Signatures
`save(shapes, path, *, ascii=True)`
`load(path)`

- `save` takes exactly one body: a `Part`, `Shell`, `Sketch`, `Face`, or a list with one of
  them.
- `ascii=True` (the default) writes a text file. `ascii=False` writes a binary file, about 40 %
  of the size.
- `load` decides by the extension, in any letter case:
  - `.step`, `.stp`, `.p21`: same as `import_step`.
  - `.stl`: same as `import_stl`, gives a `Mesh`.
  - anything else: read as `.smb`.

## Returns
`load` of an `.smb` gives a `Part`. A body that does not enclose a volume (a sketch, face or
surface) comes back as a `Shell`.

## .smb compared with STEP
| | `.smb` | STEP |
|---|---|---|
| Geometry | binary: bit-identical. ASCII: within ~1e-15 | same surface types, volume within ~1e-8 |
| Bodies per file | one (two-solid parts stay one `Part`) | any number |
| Names, colors | **lost** | kept |
| Other software | SMLib only | every CAD system |

Use `.smb` to cache an intermediate result between scripts. Use STEP to deliver a model.

## Gotchas
- `.smb` stores no name and no color. `load` returns `name None`, `color None`. Set them
  again with `.named()` and `.colored()`.
- A list of two parts raises. Fuse them, or save each to its own file.
- `load("x.glb")` or `load("x.obj")` does not say "unknown format". These files are handed to
  the native reader and fail with `KernelError: load failed`. smlibpy cannot read glTF or OBJ.
- A missing `.smb` file also gives `KernelError: load failed`, not `FileNotFoundError`.
  A missing `.step` file gives `FileNotFoundError`.
- A `Sketch` comes back as a `Shell`: its plane is lost.

## Errors
- `ValueError: an .smb file holds one body; fuse the parts or save them separately`.
- `AttributeError: 'Mesh' object has no attribute '_brep'`: you passed a mesh to `save`.
- `KernelError: load failed`: a missing file, or a file that is not `.smb`.

## Example
```python
save(bracket, "bracket.smb")                  # ASCII, exact
save(bracket, "bracket_bin.smb", ascii=False) # binary, bit-exact
again = load("bracket.smb")
print(again.volume == bracket.volume, again.name)   # True None
again = again.named(bracket.name).colored(bracket.color)   # name and color are not stored
```

## Related
`export` (writes `.smb` with `save` when the extension is `.smb`), `export_step`,
`import_step`, `import_stl`.
