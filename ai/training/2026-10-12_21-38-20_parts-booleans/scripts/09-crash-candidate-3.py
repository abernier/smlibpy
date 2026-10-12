a = Box(10, 10, 10)
print("[09] start: export_step(a - Box(20, 20, 20), '/tmp/claude-empty-check.step')", flush=True)
r = export_step(a - Box(20, 20, 20), '/tmp/claude-empty-check.step')
print("[09] ->", r, flush=True)
if r is not None:
    print("[09] valid", r.is_valid(), "vol", r.volume, flush=True)
