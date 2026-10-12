"""Render one picture per feature of the software renderer into out/render-gallery.png.

usage: python tools/render_gallery.py

Built from the example models: the bracket (asymmetric, so the two projection methods and the
mirrored views differ), the flange (round: sections, center lines) and the enclosure (two
bodies); the surface-quality tiles use a boss on a plate, its base rounded once with a circular
fillet and once with a G2 blend. Captions use the renderer's own 5 x 7 font.
"""

import importlib.util
import os
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from smlibpy import Align, Box, Cylinder, Plane, Rectangle, X, Z, diff_images, render  # noqa: E402

R = sys.modules["smlibpy.render"]  # the module (the package exports the function as smlibpy.render)

TW, TH, CAP, COLS = 500, 375, 34, 4


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, "examples", f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.model()


def tile(**kw):
    """A tile; sheets and drawings are rendered at twice the size and averaged down."""
    shapes = kw.pop("shapes")
    big = any(kw.get(k) for k in ("drawing", "sheet"))
    size = (2 * TW, 2 * TH) if big else (TW, TH)
    px = render(*shapes, size=size, **kw).pixels.astype(np.float64)
    if big:
        px = px.reshape(TH, 2, TW, 2, 3).mean(axis=(1, 3))
    return px / 255


def main() -> None:
    bracket, flange, enclosure = load("bracket"), load("flange"), load("enclosure")
    base = bracket.faces().facing(Z).bottom()  # the top face of the bracket's base
    boss = Box(60, 60, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)) + \
        Cylinder(10, 30, align=(Align.CENTER, Align.CENTER, Align.MIN))
    round_g1 = boss.fillet(boss.edges().concave(), 6)
    round_g2 = boss.fillet(boss.edges().concave(), 6, continuity="G2")
    close = {"view": {"azimuth": 0, "elevation": 20}, "zoom": 1.7, "look_at": (0, 0, 9)}
    tilted = {"view": {"azimuth": 20, "elevation": 25}, "zoom": 1.3, "look_at": (0, 0, 8)}
    t0 = time.perf_counter()
    before = render(flange, size=(TW, TH))
    after = render(flange - Cylinder(4, 80).rotate(X, 90).translate(0, 0, 26), size=(TW, TH), frame=before)
    tiles = [
        ("view='iso': z up, front-right-top", tile(shapes=[flange])),
        ("drawing='first-angle': iso e", tile(shapes=[bracket], drawing="first-angle")),
        ("drawing='third-angle': iso a", tile(shapes=[bracket], drawing="third-angle")),
        ("lines: hidden edges dashed", tile(shapes=[bracket], lines=True)),
        ("section: capped and hatched cut", tile(shapes=[flange], section=Plane.XZ)),
        ("drawing + section: section views", tile(shapes=[flange], drawing=True, section=Plane.XZ)),
        ("diff_images: before/after, pinned frame", diff_images(before, after).picture.pixels / 255),
        ("sheet: four views, one ortho scale", tile(shapes=[bracket], sheet=True)),
        ("highlight_at + markers", tile(shapes=[bracket], highlight_at=[(40, 20, 8)],
                                        markers=[((44.9, 10, 8), "m3"), ((0, 30, 33), "csk")])),
        ("highlight: a selection, edges red", tile(shapes=[flange], highlight=flange.edges().circles())),
        ("a sketch over a part, on its plane", tile(shapes=[bracket, Rectangle(26, 14).on(base)])),
        ("annotate: size, axes, scale bar", tile(shapes=[bracket], annotate=True)),
        ("xray: hidden geometry shines through", tile(shapes=[flange], xray=True)),
        ("colors='distinct': one color per body", tile(shapes=[p.colored("#8a9099") for p in enclosure],
                                                      colors="distinct", view={"azimuth": 30, "elevation": 25})),
        ("sheet=[a, b]: a view and its mirror", tile(shapes=[bracket], sheet=[{"azimuth": 30, "elevation": 30},
                                                                              {"azimuth": -30, "elevation": 30}])),
        ("zebra: circular fillet, stripes kink", tile(shapes=[round_g1], zebra=True, **close)),
        ("zebra: g2 blend, stripes bend smoothly", tile(shapes=[round_g2], zebra=True, **close)),
        ("curvature='min': circular, one color", tile(shapes=[round_g1], curvature="min", **tilted)),
        ("curvature='min': g2 blend, a ramp", tile(shapes=[round_g2], curvature="min", **tilted)),
    ]
    elapsed = time.perf_counter() - t0
    rows = (len(tiles) + 1 + COLS - 1) // COLS
    img = np.ones((rows * (TH + CAP), COLS * TW, 3))
    for i, (caption, px) in enumerate(tiles):
        x, y = (i % COLS) * TW, (i // COLS) * (TH + CAP)
        img[y:y + TH, x:x + TW] = px
        img[y + TH:y + TH + CAP, x:x + TW] = np.array([241, 242, 244]) / 255
        R._text(img, x + 12, y + TH + 10, caption, np.array([42, 47, 58]) / 255, 2)
    # the last tile: what this is
    i = len(tiles)
    x, y = (i % COLS) * TW, (i // COLS) * (TH + CAP)
    img[y:y + TH + CAP, x:x + TW] = np.array([31, 36, 48]) / 255
    lines = [("smlibpy render", 3, (255, 255, 255), 60), ("software renderer, numpy only:", 2, (170, 178, 192), 120),
             ("same shapes, same pixels", 2, (170, 178, 192), 144),
             ("views  iso front back top", 2, (215, 220, 229), 200), ("       bottom left right", 2, (215, 220, 229), 222),
             ("       azimuth / elevation", 2, (215, 220, 229), 244), ("drawing first / third angle", 2, (215, 220, 229), 280),
             ("styles shaded lines xray", 2, (215, 220, 229), 316),
             ("       zebra curvature", 2, (215, 220, 229), 338),
             (f"{len(tiles)} tiles in {elapsed:.1f} s", 2, (170, 178, 192), 372)]
    for text, scale, color, dy in lines:
        R._text(img, x + 36, y + dy, text, np.array(color) / 255, scale)
    for c in range(1, COLS):
        img[:, c * TW - 1] = np.array([213, 216, 222]) / 255
    for r in range(1, rows):
        img[r * (TH + CAP) - 1, :] = np.array([213, 216, 222]) / 255
    out = os.path.join(ROOT, "out", "render-gallery.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as fh:
        fh.write(R._png(np.clip(img * 255 + 0.5, 0, 255).astype(np.uint8)))
    print(f"{out} ({len(tiles)} tiles rendered in {elapsed:.2f} s)")


if __name__ == "__main__":
    main()
