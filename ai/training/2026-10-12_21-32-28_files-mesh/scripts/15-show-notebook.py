# notebook branch of show(), simulated: _in_notebook() forced True, display() captured
import smlibpy.viewer as vw
try:
    import IPython.display as ipd
except ImportError:
    print("[15] IPython not installed"); raise SystemExit(0)
shown = []
orig_in, orig_disp = vw._in_notebook, ipd.display
vw._in_notebook = lambda: True
ipd.display = lambda h: shown.append(h)
try:
    r = show(Box(10, 10, 10))
    print("[15] notebook, no path: returns", type(r).__name__, "displayed", len(shown), "iframe", r.data[:30])
    r = show(Box(10, 10, 10), path="ai/training/2026-10-12_21-32-28_files-mesh/files/15-nb.html", open_browser=False)
    print("[15] notebook, with path: returns", r, "displayed", len(shown))
finally:
    vw._in_notebook, ipd.display = orig_in, orig_disp
print("[15] outside notebook _in_notebook():", vw._in_notebook())
