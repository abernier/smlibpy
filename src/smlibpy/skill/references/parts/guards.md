# Guards: kernel steps in another process

The kernel can crash or loop on some inputs, and nothing stops a kernel call from outside (Ctrl-C
waits until the call returns). smlibpy runs the steps known to do so in another process, waits at
most `smlibpy.defeature.GUARD_SECONDS`, and gets the result back as an exact copy (`.smb`); this
process never runs the step itself.

## Settings

`smlibpy.defeature` holds them; set them before the step.

- `GUARD_SECONDS = 20.0`: the time one step may take. `0` runs every step in this process,
  without a limit.
- `GUARD_PROCESS = "auto"`: `"fork"`, a forked copy per step (Linux, macOS; about 1.5 ms);
  `"helper"`, one helper process for the session that gets the bodies as `.smb` (Windows, and
  processes that must not fork); `"auto"`, fork where the system can, the helper elsewhere.
  Anything else: `ValueError: smlibpy.defeature.GUARD_PROCESS must be 'auto', 'fork' or
  'helper'`.
- `GUARD_BOOLEANS = False`: `True` runs every Boolean (`+`, `-`, `&`, `merge`) in the other
  process too, for long batch runs over unknown inputs (STEP files) that must not end on a crash.

```python
import smlibpy.defeature
smlibpy.defeature.GUARD_SECONDS = 120     # a large imported part
smlibpy.defeature.GUARD_BOOLEANS = True   # a batch over unknown files
```

## Guarded steps

`remove_fillets`, `remove_faces`, `surface_fillet`, `shell`, `offset`, `thicken`, `Part.cells()`;
`fillet` and `chamfer` of parts read from files (`import_step`, `load`, `import_usd`) and of the
parts made from them; Booleans with `GUARD_BOOLEANS`.

## Errors

- A crash there: `ModelingError: shell: the kernel crashed (signal 11, in a copy of this process);
  this process is fine` (`in smlibpy's helper process` with the helper). The step is dropped;
  `remove_fillets` and `remove_faces` go on with the next one.
- Too long: `ModelingError: offset: the kernel did not finish within 20 s;
  smlibpy.defeature.GUARD_SECONDS sets the limit`.
- Ctrl-C during a guarded step stops it at once (`KeyboardInterrupt`); during any other kernel
  call it waits until the call returns.
- Errors and warnings of the step itself (`KernelError` with its status, hint and `trace` of the
  kernel there, `ValueError`) are raised here as there.
- A frozen application (no Python to start the helper with), or a helper that does not start
  within 30 s, runs the steps in this process (a `RuntimeWarning` says so once). There the
  kernel's deadline holds a step to `GUARD_SECONDS`: the loops of the kernel's surface and topology
  intersections give up once it has passed, and the step fails as "did not finish" above (within a
  few seconds of the limit). A crash still ends the process there, and a step that spends its time
  elsewhere in the kernel is not stopped.

smlibwasm runs the same steps in a probe worker (`setGuardSeconds`, `setGuardBooleans`); on a
page's main thread, where no probe worker runs, the kernel's deadline holds them to the limit.
