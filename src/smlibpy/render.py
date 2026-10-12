"""PNG pictures of shapes, rendered in software: no browser, no GPU, no extra packages.

The renderer tessellates the shapes, fills a depth buffer with smoothly shaded triangles
and draws the B-rep edges on top where they are not hidden. It is meant for quick looks,
documentation and agents that need to see what they built; :func:`show` gives the
interactive 3D view.
"""

from __future__ import annotations

import os
import struct
import zlib
from typing import Any

import numpy as np

__all__ = ["render", "VIEWS"]

#: Named views: the direction from the model towards the camera (Z up).
VIEWS: dict[str, tuple[float, float, float]] = {
    "iso": (1.0, -1.25, 0.75),
    "front": (0.0, -1.0, 0.0),
    "back": (0.0, 1.0, 0.0),
    "right": (1.0, 0.0, 0.0),
    "left": (-1.0, 0.0, 0.0),
    "top": (0.0, 0.0, 1.0),
    "bottom": (0.0, 0.0, -1.0),
}

# The sheet follows ISO projection method E (first angle): the view from the left stands to
# the right of the front view, the top view below it, the iso view in the free corner.
_SHEET = (("front", 0, 0), ("left", 0, 1), ("top", 1, 0), ("iso", 1, 1))
_SS = 2  # supersampling factor
_EDGE = np.array([0.12, 0.14, 0.16])


def render(*shapes: Any, path: str | os.PathLike[str] | None = None, view: Any = "iso",
           size: tuple[int, int] = (800, 600), edges: bool = True, background: Any = "white",
           tolerance: float | None = None) -> bytes:
    """Render shapes to a PNG image.

    Args:
        shapes: Parts, sketches, shells, faces, edges, wires, meshes, or lists of them.
        path: Also write the PNG to this file.
        view: ``"iso"`` (default), ``"front"``, ``"back"``, ``"left"``, ``"right"``,
            ``"top"``, ``"bottom"``, a direction from the model towards the camera, or
            ``"sheet"`` for a drawing sheet in ISO projection method E (first angle): front
            view, the view from the left to its right, the top view below it, and the iso view,
            all at one scale.
        size: Width and height in pixels.
        edges: Draw the edges of faces (hidden edges stay hidden).
        background: Background color.
        tolerance: Tessellation tolerance; default 0.1 % of each body's size.

    Returns:
        The PNG file contents.
    """
    from .colors import to_rgb

    w, h = int(size[0]), int(size[1])
    scene = _Scene(shapes, tolerance)
    bg = np.array(to_rgb(background), dtype=np.float64)
    if isinstance(view, str) and view == "sheet":
        cw, ch = w // 2, h // 2
        cams = [_Camera(VIEWS[v]) for v, _, _ in _SHEET]
        scale = min(c.fit_scale(scene, cw, ch) for c in cams)
        img = np.empty((h, w, 3))
        img[:] = bg
        for (name, row, col), cam in zip(_SHEET, cams):
            tile = _draw(scene, cam, cw, ch, bg, edges, scale)
            y0, x0 = row * ch, col * cw
            img[y0:y0 + ch, x0:x0 + cw] = tile
            _label(img, name.upper(), x0 + 8, y0 + 8)
        img[ch - 1:ch + 1, :] = img[ch - 1:ch + 1, :] * 0.6 + 0.4 * 0.75
        img[:, cw - 1:cw + 1] = img[:, cw - 1:cw + 1] * 0.6 + 0.4 * 0.75
    else:
        direction = VIEWS[view] if isinstance(view, str) else tuple(float(c) for c in view)
        cam = _Camera(direction)
        img = _draw(scene, cam, w, h, bg, edges, cam.fit_scale(scene, w, h))
    data = _png(np.clip(img * 255.0 + 0.5, 0, 255).astype(np.uint8))
    if path is not None:
        with open(os.fspath(path), "wb") as fh:
            fh.write(data)
    return data


# -----------------------------------------------------------------------------
# scene
# -----------------------------------------------------------------------------
class _Scene:
    """Triangles (with corner normals and colors) and edge segments in world space."""

    def __init__(self, shapes: Any, tolerance: float | None):
        from .colors import to_rgb
        from .exporters import _DEFAULT_COLORS, _curve_points, _edge_polylines, _flatten_all
        from .mesh import Mesh, tessellate
        from .shapes import Edge, Face, Part, Wire, _Body

        tris, norms, cols, solid = [], [], [], []
        segs, seg_cols = [], []
        for i, item in enumerate(_flatten_all(shapes)):
            color = getattr(item, "color", None)
            rgb = np.array(to_rgb(color if color is not None else _DEFAULT_COLORS[i % len(_DEFAULT_COLORS)]))
            if isinstance(item, (Edge, Wire)):
                for pl in _curve_points(item):
                    segs.append(np.stack([pl[:-1], pl[1:]], axis=1))
                    seg_cols.append(np.repeat((rgb * 0.75)[None], len(pl) - 1, axis=0))
                continue
            if isinstance(item, Mesh):
                mesh = item
            elif isinstance(item, (_Body, Face)):
                mesh = tessellate(item, tolerance)
                lines = _edge_polylines(item) if isinstance(item, _Body) else _curve_points(item)
                for pl in lines:
                    segs.append(np.stack([pl[:-1], pl[1:]], axis=1))
                    seg_cols.append(np.repeat(_EDGE[None], len(pl) - 1, axis=0))
            else:
                continue
            if len(mesh.triangles) == 0:
                continue
            v = mesh.vertices[mesh.triangles]
            n = mesh.normals if mesh.normals is not None else np.repeat(mesh.triangle_normals[:, None], 3, axis=1)
            tris.append(v)
            norms.append(np.asarray(n, dtype=np.float64))
            cols.append(np.repeat(rgb[None], len(v), axis=0))
            closed = isinstance(item, Part) and item.is_valid()
            solid.append(np.full(len(v), closed))
        self.tris = np.concatenate(tris) if tris else np.zeros((0, 3, 3))
        self.norms = np.concatenate(norms) if norms else np.zeros((0, 3, 3))
        self.cols = np.concatenate(cols) if cols else np.zeros((0, 3))
        self.solid = np.concatenate(solid) if solid else np.zeros(0, dtype=bool)
        self.segs = np.concatenate(segs) if segs else np.zeros((0, 2, 3))
        self.seg_cols = np.concatenate(seg_cols) if seg_cols else np.zeros((0, 3))
        pts = [self.tris.reshape(-1, 3), self.segs.reshape(-1, 3)]
        allp = np.concatenate(pts)
        if len(allp) == 0:
            raise ValueError("nothing to render")
        self.lo, self.hi = allp.min(axis=0), allp.max(axis=0)
        self.center = (self.lo + self.hi) / 2
        self.points = allp


class _Camera:
    def __init__(self, direction: tuple[float, float, float]):
        back = np.asarray(direction, dtype=np.float64)
        back = back / np.linalg.norm(back)
        right = np.cross([0.0, 0.0, 1.0], back)
        if np.linalg.norm(right) < 1e-9:
            right = np.array([1.0, 0.0, 0.0]) if back[2] > 0 else np.array([1.0, 0.0, 0.0])
        right = right / np.linalg.norm(right)
        up = np.cross(back, right)
        self.back, self.right, self.up = back, right, up / np.linalg.norm(up)

    def project(self, p: np.ndarray, center: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        d = p - center
        return d @ self.right, d @ self.up, d @ self.back

    def outline(self, scene: _Scene) -> tuple[float, float, float, float]:
        """Middle and extent of the scene on the screen plane."""
        x, y, _ = self.project(scene.points, scene.center)
        return (float(x.max() + x.min()) / 2, float(y.max() + y.min()) / 2,
                max(float(np.ptp(x)), 1e-9), max(float(np.ptp(y)), 1e-9))

    def fit_scale(self, scene: _Scene, w: int, h: int) -> float:
        _, _, span_x, span_y = self.outline(scene)
        return min(w * 0.88 / span_x, h * 0.88 / span_y)


# -----------------------------------------------------------------------------
# rasterizer
# -----------------------------------------------------------------------------
def _draw(scene: _Scene, cam: _Camera, w: int, h: int, bg: np.ndarray, edges: bool, scale: float) -> np.ndarray:
    W, H, s = w * _SS, h * _SS, scale * _SS
    img = np.empty((H * W, 3))
    img[:] = bg
    zbuf = np.full(H * W, -np.inf)

    mx, my, _, _ = cam.outline(scene)

    def to_screen(p: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        x, y, z = cam.project(p, scene.center)
        return (x - mx) * s + W / 2.0, H / 2.0 - (y - my) * s, z

    if len(scene.tris):
        sx, sy, sz = to_screen(scene.tris.reshape(-1, 3))
        sx, sy, sz = sx.reshape(-1, 3), sy.reshape(-1, 3), sz.reshape(-1, 3)
        # shading per corner: a key light from the upper left, a fill light, ambient
        n = scene.norms
        nn = n / np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-12)
        nb = nn @ cam.back
        flip = np.where(nb < 0, -1.0, 1.0)[..., None]  # both sides of open surfaces lit
        nn = nn * flip
        key = _unit(-0.45 * cam.right + 0.65 * cam.up + 0.9 * cam.back)
        fill = _unit(0.6 * cam.right - 0.2 * cam.up + 0.8 * cam.back)
        half = _unit(key + cam.back)
        diff = np.clip(nn @ key, 0, 1)
        spec = np.clip(nn @ half, 0, 1) ** 40
        light = 0.30 + 0.62 * diff + 0.16 * np.clip(nn @ fill, 0, 1)
        shade = scene.cols[:, None, :] * light[..., None] + 0.10 * spec[..., None]
        # solids: faces turned away from the camera are never seen
        geo = np.cross(scene.tris[:, 1] - scene.tris[:, 0], scene.tris[:, 2] - scene.tris[:, 0]) @ cam.back
        keep = ~(scene.solid & (geo < 0))
        _fill(sx[keep], sy[keep], sz[keep], shade[keep], W, H, img, zbuf)
    if edges and len(scene.segs):
        a = to_screen(scene.segs[:, 0])
        b = to_screen(scene.segs[:, 1])
        depth_range = float(np.ptp(scene.points @ cam.back)) or 1.0
        bias = max(depth_range * 2e-3, 2.5 / s)
        _lines(a, b, scene.seg_cols, W, H, img, zbuf, bias)
    img = img.reshape(H, W, 3)
    return img.reshape(h, _SS, w, _SS, 3).mean(axis=(1, 3))


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def _fill(x: np.ndarray, y: np.ndarray, z: np.ndarray, shade: np.ndarray, W: int, H: int,
          img: np.ndarray, zbuf: np.ndarray) -> None:
    """Rasterize triangles into the image with a depth test (larger z is nearer)."""
    area = (x[:, 1] - x[:, 0]) * (y[:, 2] - y[:, 0]) - (x[:, 2] - x[:, 0]) * (y[:, 1] - y[:, 0])
    ok = np.abs(area) > 1e-12
    x, y, z, shade, area = x[ok], y[ok], z[ok], shade[ok], area[ok]
    x0 = np.clip(np.floor(x.min(axis=1)), 0, W - 1).astype(np.int64)
    x1 = np.clip(np.ceil(x.max(axis=1)), 0, W - 1).astype(np.int64)
    y0 = np.clip(np.floor(y.min(axis=1)), 0, H - 1).astype(np.int64)
    y1 = np.clip(np.ceil(y.max(axis=1)), 0, H - 1).astype(np.int64)
    span = np.maximum(x1 - x0, y1 - y0) + 1
    idx_all, z_all, c_all = [], [], []
    k = 2
    lo = 0
    while lo < int(span.max(initial=0)) + 1:
        sel = np.nonzero((span > lo) & (span <= k))[0]
        lo = k
        if len(sel):
            per = k * k
            step = max(1, 4_000_000 // per)
            for c0 in range(0, len(sel), step):
                part = sel[c0:c0 + step]
                _fill_class(part, k, x, y, z, shade, area, x0, x1, y0, y1, W, idx_all, z_all, c_all)
        k *= 2
    if not idx_all:
        return
    idx = np.concatenate(idx_all)
    zz = np.concatenate(z_all)
    cc = np.concatenate(c_all)
    order = np.lexsort((-zz, idx))  # by pixel, nearest first
    idx, zz, cc = idx[order], zz[order], cc[order]
    first = np.ones(len(idx), dtype=bool)
    first[1:] = idx[1:] != idx[:-1]
    idx, zz, cc = idx[first], zz[first], cc[first]
    near = zz > zbuf[idx]
    zbuf[idx[near]] = zz[near]
    img[idx[near]] = cc[near]


def _fill_class(sel: np.ndarray, k: int, x: np.ndarray, y: np.ndarray, z: np.ndarray, shade: np.ndarray,
                area: np.ndarray, x0: np.ndarray, x1: np.ndarray, y0: np.ndarray, y1: np.ndarray, W: int,
                idx_all: list[np.ndarray], z_all: list[np.ndarray], c_all: list[np.ndarray]) -> None:
    g = np.arange(k)
    px = x0[sel][:, None, None] + g[None, None, :]
    py = y0[sel][:, None, None] + g[None, :, None]
    inside_box = (px <= x1[sel][:, None, None]) & (py <= y1[sel][:, None, None])
    cx, cy = px + 0.5, py + 0.5
    X, Y = x[sel][:, :, None, None], y[sel][:, :, None, None]
    # barycentric weights from edge functions
    w0 = (X[:, 1] - cx) * (Y[:, 2] - cy) - (X[:, 2] - cx) * (Y[:, 1] - cy)
    w1 = (X[:, 2] - cx) * (Y[:, 0] - cy) - (X[:, 0] - cx) * (Y[:, 2] - cy)
    a = area[sel][:, None, None]
    w0 = w0 / a
    w1 = w1 / a
    w2 = 1.0 - w0 - w1
    eps = -1e-9
    inside = inside_box & (w0 >= eps) & (w1 >= eps) & (w2 >= eps)
    t, r, c = np.nonzero(inside)
    if len(t) == 0:
        return
    b0, b1, b2 = w0[t, r, c], w1[t, r, c], w2[t, r, c]
    tri = sel[t]
    zz = b0 * z[tri, 0] + b1 * z[tri, 1] + b2 * z[tri, 2]
    cc = b0[:, None] * shade[tri, 0] + b1[:, None] * shade[tri, 1] + b2[:, None] * shade[tri, 2]
    idx_all.append((y0[sel][t] + r) * W + x0[sel][t] + c)
    z_all.append(zz)
    c_all.append(cc)


def _lines(a: tuple[np.ndarray, np.ndarray, np.ndarray], b: tuple[np.ndarray, np.ndarray, np.ndarray],
           cols: np.ndarray, W: int, H: int, img: np.ndarray, zbuf: np.ndarray, bias: float) -> None:
    """Draw segments about 1.5 output pixels wide where they are not hidden."""
    ax, ay, az = a
    bx, by, bz = b
    length = np.hypot(bx - ax, by - ay)
    n = np.maximum(np.ceil(length * 1.5).astype(np.int64), 1) + 1
    seg = np.repeat(np.arange(len(n)), n)
    start = np.repeat(np.cumsum(n) - n, n)
    t = (np.arange(int(n.sum())) - start) / np.repeat(n - 1, n).clip(min=1)
    px = ax[seg] + (bx[seg] - ax[seg]) * t
    py = ay[seg] + (by[seg] - ay[seg]) * t
    pz = az[seg] + (bz[seg] - az[seg]) * t
    ix, iy = np.floor(px).astype(np.int64), np.floor(py).astype(np.int64)
    inside = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
    ix, iy, pz, seg = ix[inside], iy[inside], pz[inside], seg[inside]
    # visible where nothing in front of the line (the surface it lies on is within the bias)
    visible = pz >= zbuf[iy * W + ix] - bias
    ix, iy, seg = ix[visible], iy[visible], seg[visible]
    for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1), (-1, 0), (0, -1)):
        jx, jy = ix + dx, iy + dy
        ok = (jx >= 0) & (jx < W) & (jy >= 0) & (jy < H)
        img[jy[ok] * W + jx[ok]] = cols[seg[ok]]


# -----------------------------------------------------------------------------
# labels and PNG
# -----------------------------------------------------------------------------
_FONT = {  # 5x7 glyphs, rows top to bottom, bit 4 = left column
    "A": (14, 17, 17, 31, 17, 17, 17), "B": (30, 17, 17, 30, 17, 17, 30), "C": (14, 17, 16, 16, 16, 17, 14),
    "E": (31, 16, 16, 30, 16, 16, 31), "F": (31, 16, 16, 30, 16, 16, 16), "G": (14, 17, 16, 23, 17, 17, 15),
    "H": (17, 17, 17, 31, 17, 17, 17), "I": (14, 4, 4, 4, 4, 4, 14), "K": (17, 18, 20, 24, 20, 18, 17),
    "L": (16, 16, 16, 16, 16, 16, 31), "M": (17, 27, 21, 21, 17, 17, 17), "N": (17, 25, 21, 19, 17, 17, 17),
    "O": (14, 17, 17, 17, 17, 17, 14), "P": (30, 17, 17, 30, 16, 16, 16), "R": (30, 17, 17, 30, 20, 18, 17),
    "S": (15, 16, 16, 14, 1, 1, 30), "T": (31, 4, 4, 4, 4, 4, 4), "W": (17, 17, 17, 21, 21, 21, 10),
}


def _label(img: np.ndarray, text: str, x: int, y: int, scale: int = 2) -> None:
    color = np.array([0.35, 0.37, 0.4])
    for ch in text:
        rows = _FONT.get(ch)
        if rows is not None:
            for r, bits in enumerate(rows):
                for col in range(5):
                    if bits & (16 >> col):
                        yy, xx = y + r * scale, x + col * scale
                        img[yy:yy + scale, xx:xx + scale] = color
        x += 6 * scale


def _png(img: np.ndarray) -> bytes:
    h, w, _ = img.shape
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), img.reshape(h, w * 3)], axis=1).tobytes()

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
