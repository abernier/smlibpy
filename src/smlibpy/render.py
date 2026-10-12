"""PNG pictures of shapes, rendered in software: no browser, no GPU, no extra packages.

The renderer tessellates the shapes, fills a depth buffer with their triangles, shades every
pixel and draws the B-rep edges on top where they are not hidden. Besides the shaded view it
draws technical drawings (visible lines solid, hidden lines dashed), sheets of several views,
sections with hatched cut faces, x-ray views, highlighted faces and edges, markers and a
measurement overlay, and it compares two pictures pixel by pixel. It is meant for quick looks,
documentation and agents that need to see what they built; :func:`show` gives the
interactive 3D view.

The same input gives the same pixels: views are fixed, orthographic and fitted to the
shapes, and nothing depends on an earlier call.
"""

from __future__ import annotations

import math
import os
import struct
import zlib
from dataclasses import dataclass, replace
from typing import Any

import numpy as np

__all__ = ["render", "diff_images", "Picture", "ImageDiff", "VIEWS"]

# Named views as turntable angles (azimuth, elevation) in degrees, Z up: azimuth 0 looks
# from the front (camera at -Y), 90 from the right (camera at +X); elevation 90 from above.
_TURNTABLE: dict[str, tuple[float, float]] = {
    "iso": (45.0, math.degrees(math.atan(1 / math.sqrt(2)))),  # 35.264: a true isometric view
    "front": (0.0, 0.0),
    "back": (180.0, 0.0),
    "right": (90.0, 0.0),
    "left": (-90.0, 0.0),
    "top": (0.0, 90.0),
    "bottom": (0.0, -90.0),
}


def _towards_camera(az: float, el: float) -> tuple[float, float, float]:
    a, e = math.radians(az), math.radians(el)
    v = (math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))
    return tuple(0.0 if abs(c) < 1e-12 else c for c in v)  # type: ignore[return-value]


#: Named views: the direction from the model towards the camera (Z up).
VIEWS: dict[str, tuple[float, float, float]] = {name: _towards_camera(*ae) for name, ae in _TURNTABLE.items()}

_ORTHO = ("front", "back", "left", "right", "top", "bottom")
_EDGE = np.array([0.12, 0.14, 0.16])
_INK = np.array([20, 20, 20]) / 255
_HIDDEN_INK = np.array([95, 95, 95]) / 255
_HATCH_INK = np.array([70, 70, 70]) / 255
_LABEL = np.array([70, 70, 70]) / 255
_ORANGE = np.array([1.0, 0.45, 0.05])  # highlighted faces and bodies
_RED = np.array([230, 40, 30]) / 255  # highlighted edges
_MARKER = np.array([220, 30, 30]) / 255
_OVERLAY = np.array([0, 90, 220]) / 255  # sketches drawn over solids
_DIVIDER = np.array([190, 190, 190]) / 255
_WHITE = np.ones(3)
_FIT = 0.88  # share of the picture the shapes fill
_MAX_CANVAS = 1 << 24  # subpixels of a supersampled picture; larger pictures get a lower factor
_CAPTION = 34  # pixels kept free under the iso view of a drawing, for the projection method
_CURVATURES = ("gaussian", "mean", "max", "min")
# blue (concave) - white (flat) - red (convex), positions 0 to 1 with 0.5 = zero curvature
_CURVATURE_MAP = (np.array([0.0, 0.25, 0.5, 0.75, 1.0]),
                  np.array([[59, 76, 192], [141, 176, 254], [236, 236, 236], [244, 154, 123], [180, 4, 38]]) / 255)
_ZEBRA_DARK, _ZEBRA_LIGHT = np.array([0.08, 0.08, 0.09]), np.array([0.97, 0.97, 0.97])
_ZEBRA_EDGE = np.array([0.5, 0.5, 0.5])


# -----------------------------------------------------------------------------
# results
# -----------------------------------------------------------------------------
class Picture(bytes):
    """A render: the PNG file contents (it *is* the ``bytes`` of the file) and what the render
    knows about itself.

    Attributes:
        pixels: ``(height, width, 3)`` ``uint8`` array of the picture.
        frame: The frame of a single view, ``{"scale", "mid_x", "mid_y"}``: output pixels per
            model unit, and the projected point in the middle of the picture. Pass it as
            ``frame=`` to a later render of the same view and size to get pictures that
            compare pixel by pixel. ``None`` for sheets and drawings.
    """

    pixels: np.ndarray
    frame: dict[str, float] | None

    def __new__(cls, data: bytes, pixels: np.ndarray | None = None, frame: dict[str, float] | None = None) -> Picture:
        obj = super().__new__(cls, data)
        obj.pixels = pixels if pixels is not None else _png_decode(data)
        obj.frame = frame
        return obj

    @property
    def width(self) -> int:
        return int(self.pixels.shape[1])

    @property
    def height(self) -> int:
        return int(self.pixels.shape[0])

    def save(self, path: str | os.PathLike[str]) -> None:
        """Write the PNG file."""
        with open(os.fspath(path), "wb") as fh:
            fh.write(self)

    def __repr__(self) -> str:
        return f"Picture({self.width} x {self.height}, frame={self.frame})"


@dataclass(repr=False)
class ImageDiff:
    """The result of :func:`diff_images`.

    Attributes:
        changed: Number of pixels that differ.
        total: Number of pixels.
        fraction: ``changed / total``.
        bbox: ``(x0, y0, x1, y1)`` of the changed pixels (inclusive), or ``None``.
        picture: A :class:`Picture` of the difference: changed pixels red on a faded gray of
            the second picture.
    """

    changed: int
    total: int
    fraction: float
    bbox: tuple[int, int, int, int] | None
    picture: Picture

    def save(self, path: str | os.PathLike[str]) -> None:
        """Write the picture of the difference as a PNG file."""
        self.picture.save(path)

    def __repr__(self) -> str:
        return f"ImageDiff(changed={self.changed}, fraction={self.fraction:.4g}, bbox={self.bbox})"


# -----------------------------------------------------------------------------
# public functions
# -----------------------------------------------------------------------------
def render(*shapes: Any, path: str | os.PathLike[str] | None = None, view: Any = "iso",
           size: tuple[int, int] = (800, 600), edges: bool = True, background: Any = "white",
           tolerance: float | None = None, zoom: float = 1.0, look_at: Any = None, frame: Any = None,
           supersample: int = 2, colors: str = "native", lines: bool = False, drawing: Any = False,
           sheet: Any = False, section: Any = None, cap: bool = True, highlight: Any = None,
           highlight_at: Any = None, markers: Any = None, annotate: bool = False, xray: bool = False,
           xray_alpha: float = 0.42, zebra: Any = False, curvature: Any = None) -> Picture:
    """Render shapes to a PNG image.

    The options combine: a sectioned drawing with highlights and markers is fine.

    Args:
        shapes: Parts, sketches, shells, faces, edges, wires, meshes, or lists of them. Edges,
            wires, and sketches shown together with solids, are drawn on top of everything at
            their place in space.
        path: Also write the PNG to this file.
        view: The camera, orthographic, Z up:

            - a name: ``"iso"`` (default; a true isometric view from front, right and above),
              ``"front"``, ``"back"``, ``"left"``, ``"right"``, ``"top"``, ``"bottom"``;
            - ``{"azimuth": a, "elevation": e}`` in degrees: azimuth 0 looks from the front,
              90 from the right (+X); elevation 90 from above. ``"iso"`` is azimuth 45,
              elevation 35.264; ``"right"`` is azimuth 90;
            - ``{"direction": (x, y, z), "up": (x, y, z)}``: the direction the camera looks
              in (from the camera towards the model); ``up`` defaults to Z;
            - a tuple ``(x, y, z)``: the direction from the model towards the camera;
            - ``"sheet"``: the same as ``drawing="first-angle"``.

            Views are never mirrored.
        size: Width and height in pixels.
        edges: Draw the edges of faces in the shaded view (hidden edges stay hidden).
        background: Background color.
        tolerance: Tessellation tolerance; default 0.1 % of each body's size.
        zoom: Factor on the scale that fits the shapes (2 shows half as much).
        look_at: A point that lands in the middle of the picture.
        frame: The frame of an earlier render of the same view and size (its
            ``Picture.frame``, or the picture itself): scale and middle stay the same, so
            pictures of a changed model compare pixel by pixel (:func:`diff_images`).
            Overrides ``zoom`` and ``look_at``.
        supersample: Render at this many times the size and average down (1 to 4); 2 gives
            smooth edges. Very large pictures get a lower factor (16 million subpixels at most).
        colors: ``"native"``: each shape's own color, or a palette color by its position;
            ``"distinct"``: a palette color per body, also per solid of a part.
        lines: Line style instead of shading: no fill, visible edges and silhouettes solid,
            hidden ones dashed. Applies to the single view and every panel of a sheet.
        drawing: A technical drawing: front, top and side view in line style, aligned at one
            scale, and a shaded iso view in the free corner. ``True`` or ``"first-angle"``
            (ISO 5456-2 method E): the top view below the front view, the view from the left
            to its right. ``"third-angle"`` (method A): the top view above the front view, the
            view from the right to its right. ``{"projection": ..., "side": "left" |
            "right", "iso": bool}`` picks the side view or leaves the corner empty.
        sheet: Several shaded views in one picture: ``True`` (top, iso, front, right), a list
            of 4 views (2 x 2) or of 2 views side by side. Named ortho views share one scale;
            the others fit themselves. ``drawing`` wins over ``sheet``.
        section: Cut at a plane and leave out what is on the positive side of its normal: a
            :class:`Plane`, a planar face, ``(origin, normal)`` or ``{"origin", "normal",
            "cap"}``. The picture keeps the framing of the whole model.
        cap: Fill the cut faces of closed bodies, hatched at 45 degrees (neighbouring bodies
            alternate the direction); bores and pockets stay open. ``False`` leaves the cut
            open and shows the inside walls shaded darker.
        highlight: Shapes drawn in signal colors: faces and bodies orange, edges red. Faces,
            edges, wires, parts, vertices or selections (``part.edges().concave()``).
        highlight_at: Points; the face closest to each point is highlighted.
        markers: Crosshairs with labels, drawn on top: points ``(x, y, z)``, ``(point,
            label)``, or ``{"position", "label", "color"}``.
        annotate: Measurement overlay: the size of the bounding box (``"60 X 54 X 34"``), the
            axes as seen in the view (an axis pointing into the screen is left out) and a
            scale bar of a round length.
        xray: Translucent bodies: hidden faces shine through, edges stay opaque.
        xray_alpha: Opacity of each face in the x-ray view (0 to 1).
        zebra: Zebra stripes: the reflection of parallel light lines on the shaded surfaces,
            from the exact surface normals. Stripes break where surfaces meet with a gap or an
            edge (G0), kink where they meet tangentially (G1, a circular fillet) and run
            smoothly across curvature-continuous joints (G2). ``True``, or ``{"stripes": 16,
            "width": 0.5, "direction": "vertical"}``: the number of black stripes around the
            light, the black share of each, and the direction of the light lines
            (``"vertical"`` or ``"horizontal"`` on the screen, or a world direction).
            Surfaces that curve along the light lines show none; turn the direction for them.
        curvature: A curvature map of the exact surfaces: ``"mean"``, ``"gaussian"``,
            ``"max"`` or ``"min"`` (the principal curvatures). Blue is concave, white flat,
            red convex (a sphere of radius R has 1/R everywhere); a legend gives the range in
            1/mm (1/mm^2 for Gaussian). ``{"kind": "mean", "range": 0.2}`` (or ``(lo, hi)``)
            fixes the range; by default it spans the values on the shapes.

    Returns:
        A :class:`Picture`: the PNG file contents as ``bytes``, with ``.pixels`` and ``.frame``.
    """
    from .colors import to_rgb

    w, h = int(size[0]), int(size[1])
    if w < 1 or h < 1:
        raise ValueError(f"size must be positive, got {size!r}")
    k = int(supersample)
    if not 1 <= k <= 4:
        raise ValueError(f"supersample must be 1 to 4, got {supersample!r}")
    k = max(1, min(k, int(math.sqrt(_MAX_CANVAS / (w * h)))))
    if colors not in ("native", "distinct"):
        raise ValueError(f"colors must be 'native' or 'distinct', got {colors!r}")
    if not 0 < float(xray_alpha) < 1:
        raise ValueError(f"xray_alpha must be between 0 and 1, got {xray_alpha!r}")
    if isinstance(view, str) and view.strip().lower() == "sheet":
        drawing = drawing or True
    stripes, curv = _zebra_spec(zebra), _curvature_spec(curvature)
    opts = _Options(k=k, bg=np.array(to_rgb(background), dtype=np.float64), edges=bool(edges), lines=bool(lines),
                    xray=bool(xray) and not lines, alpha=float(xray_alpha), section=_section(section, cap),
                    markers=_markers(markers), annotate=bool(annotate), zebra=stripes)
    scene = _Scene(shapes, tolerance, colors, fine=bool(stripes or curv))
    scene.add_highlights(highlight, highlight_at)
    if curv is not None:
        opts.curvature = (curv[0], *scene.curvature_range(*curv))

    used = None
    if drawing is not None and drawing is not False:
        img = _drawing(scene, w, h, opts, drawing)
    elif sheet is not None and sheet is not False:
        img = _sheet(scene, _sheet_views(sheet), w, h, opts)
    else:
        cam = _Camera.of(view)
        used = _frame(frame) or _fit(scene, cam, w, h, zoom, look_at)
        img = _view(scene, cam, w, h, opts, used)
    pixels = np.clip(img * 255.0 + 0.5, 0, 255).astype(np.uint8)
    pic = Picture(_png(pixels), pixels, dict(used) if used else None)
    if path is not None:
        pic.save(path)
    return pic


def diff_images(a: Any, b: Any, tolerance: int = 0) -> ImageDiff:
    """Compare two pictures of the same size pixel by pixel.

    Meaningful for two renders of the same view with a pinned frame (``frame=`` of the
    first): without it, a changed model is fitted anew and every pixel moves.

    Args:
        a, b: Pictures from :func:`render`, PNG bytes, PNG file paths, or ``(h, w, 3)``
            ``uint8`` arrays.
        tolerance: Largest difference per color channel (0 to 255) that still counts as equal.

    Returns:
        An :class:`ImageDiff`: the number, share and bounding box of the changed pixels, and a
        picture of the difference (changed pixels red on a faded gray of ``b``).
    """
    pa, pb = _pixels_of(a), _pixels_of(b)
    if pa.shape != pb.shape:
        raise ValueError(f"diff_images: the pictures differ in size ({pa.shape[1]} x {pa.shape[0]} and "
                         f"{pb.shape[1]} x {pb.shape[0]})")
    changed = (np.abs(pa.astype(np.int16) - pb.astype(np.int16)) > int(tolerance)).any(axis=2)
    lum = pb[..., 0] * 0.299 + pb[..., 1] * 0.587 + pb[..., 2] * 0.114
    gray = np.round(255 - (255 - lum) * 0.25).astype(np.uint8)
    out = np.repeat(gray[..., None], 3, axis=2)
    out[changed] = (220, 30, 30)
    n = int(changed.sum())
    bbox = None
    if n:
        ys, xs = np.nonzero(changed)
        bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    total = int(changed.size)
    return ImageDiff(n, total, n / total, bbox, Picture(_png(out), out))


def _pixels_of(img: Any) -> np.ndarray:
    if isinstance(img, Picture):
        return img.pixels
    if isinstance(img, np.ndarray):
        arr = img if img.dtype == np.uint8 else np.clip(np.asarray(img) * 255 + 0.5, 0, 255).astype(np.uint8)
        return arr[..., :3]
    if isinstance(img, (bytes, bytearray)):
        return _png_decode(bytes(img))
    with open(os.fspath(img), "rb") as fh:
        return _png_decode(fh.read())


# -----------------------------------------------------------------------------
# options
# -----------------------------------------------------------------------------
@dataclass
class _Cut:
    origin: np.ndarray
    normal: np.ndarray
    cap: bool

    def distance(self, p: np.ndarray) -> np.ndarray:
        return (p - self.origin) @ self.normal


@dataclass
class _Options:
    k: int
    bg: np.ndarray
    edges: bool
    lines: bool
    xray: bool
    alpha: float
    section: _Cut | None
    markers: list[tuple[np.ndarray, str, np.ndarray]]
    annotate: bool
    zebra: dict[str, Any] | None = None
    curvature: tuple[str, float, float] | None = None  # kind and the range of the color map
    legend: bool = True  # draw the legend of the curvature map

    def panel(self, lines: bool, legend: bool = True) -> _Options:
        return replace(self, lines=lines, xray=self.xray and not lines, legend=legend)


def _zebra_spec(zebra: Any) -> dict[str, Any] | None:
    if zebra is None or zebra is False:
        return None
    spec = dict(zebra) if isinstance(zebra, dict) else {}
    unknown = set(spec) - {"stripes", "width", "direction"}
    if unknown or not (zebra is True or isinstance(zebra, dict)):
        raise ValueError(f"zebra takes True or a dict of stripes, width and direction, got {zebra!r}")
    stripes = int(spec.get("stripes", 16))
    width = float(spec.get("width", 0.5))
    direction = spec.get("direction", "vertical")
    if stripes < 1:
        raise ValueError(f"zebra: stripes must be at least 1, got {stripes}")
    if not 0 < width < 1:
        raise ValueError(f"zebra: width is the black share of a stripe, between 0 and 1, got {width}")
    if isinstance(direction, str):
        if direction not in ("vertical", "horizontal"):
            raise ValueError(f"zebra: direction is 'vertical', 'horizontal' or a vector, got {direction!r}")
    else:
        direction = _vec3(direction)
        if np.linalg.norm(direction) < 1e-12:
            raise ValueError("zebra: the direction has no length")
    return {"stripes": stripes, "width": width, "direction": direction}


def _curvature_spec(curvature: Any) -> tuple[str, Any] | None:
    if curvature is None or curvature is False:
        return None
    if isinstance(curvature, str):
        kind, span = curvature, None
    elif isinstance(curvature, dict):
        kind, span = curvature.get("kind", "mean"), curvature.get("range")
    else:
        raise ValueError(f"curvature takes 'mean', 'gaussian', 'max', 'min' or a dict, got {curvature!r}")
    kind = str(kind).lower()
    if kind not in _CURVATURES:
        raise ValueError(f"curvature: the kinds are {', '.join(_CURVATURES)}, got {kind!r}")
    if span is not None:
        lo, hi = (-abs(float(span)), abs(float(span))) if _is_number(span) else (float(span[0]), float(span[1]))
        if not hi > lo:
            raise ValueError(f"curvature: the range must be (low, high), got {span!r}")
        span = (lo, hi)
    return kind, span


def _vec3(p: Any) -> np.ndarray:
    if hasattr(p, "to_tuple"):
        p = p.to_tuple()
    elif hasattr(p, "center") and not isinstance(p, (list, tuple, np.ndarray)):
        p = p.center().to_tuple()
    v = np.asarray(p, dtype=np.float64).reshape(-1)
    if v.shape != (3,) or not np.isfinite(v).all():
        raise ValueError(f"expected a point (x, y, z), got {p!r}")
    return v


def _section(section: Any, cap: bool) -> _Cut | None:
    from .geometry import Plane
    from .shapes import Face, Shape

    if section is None or section is False:
        return None
    if isinstance(section, (list, tuple)) and section and all(isinstance(f, Shape) for f in section):
        if len(section) != 1:
            raise TypeError(f"section takes one planar face, got {len(section)} shapes")
        section = section[0]
    if isinstance(section, dict):
        if "origin" not in section or "normal" not in section:
            raise ValueError(f"section: a dict needs origin and normal, got {section!r}")
        origin, normal = section["origin"], section["normal"]
        cap = bool(section.get("cap", cap))
    elif isinstance(section, Plane):
        origin, normal = section.origin, section.z_dir
    elif isinstance(section, Face):
        plane = Plane(section)
        origin, normal = plane.origin, plane.z_dir
    elif isinstance(section, (list, tuple)) and len(section) == 2:
        origin, normal = section
    else:
        raise TypeError(f"section takes a Plane, a planar Face, (origin, normal) or a dict, got {section!r}")
    n = _vec3(normal)
    length = float(np.linalg.norm(n))
    if length < 1e-12:
        raise ValueError("section: the normal has no length")
    return _Cut(_vec3(origin), n / length, bool(cap))


def _markers(markers: Any) -> list[tuple[np.ndarray, str, np.ndarray]]:
    from .colors import to_rgb

    if markers is None:
        return []
    if isinstance(markers, dict) or _is_point(markers):
        markers = [markers]
    out = []
    for m in markers:
        label, color = "", _MARKER
        if isinstance(m, dict):
            pos = m["position"]
            label = str(m.get("label") or "")
            if m.get("color") is not None:
                color = np.array(to_rgb(m["color"]))
        elif isinstance(m, (list, tuple)) and len(m) in (2, 3) and not _is_number(m[0]):
            pos, label = m[0], str(m[1] or "")
            if len(m) == 3 and m[2] is not None:
                color = np.array(to_rgb(m[2]))
        else:
            pos = m
        out.append((_vec3(pos), label, color))
    return out


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float, np.number))


def _is_point(p: Any) -> bool:
    if hasattr(p, "to_tuple"):
        return True
    if not isinstance(p, (list, tuple, np.ndarray)) or len(p) != 3:
        return False
    return all(_is_number(c) for c in p)


def _frame(frame: Any) -> dict[str, float] | None:
    if frame is None:
        return None
    if isinstance(frame, Picture):
        if frame.frame is None:
            raise ValueError("frame: this picture has no frame (sheets and drawings have none)")
        frame = frame.frame
    if isinstance(frame, dict):
        try:
            out = {"scale": float(frame["scale"]), "mid_x": float(frame.get("mid_x", frame.get("midX"))),
                   "mid_y": float(frame.get("mid_y", frame.get("midY")))}
        except (KeyError, TypeError) as e:
            raise ValueError(f"frame needs scale, mid_x and mid_y, got {frame!r}") from e
    else:
        s, mx, my = frame
        out = {"scale": float(s), "mid_x": float(mx), "mid_y": float(my)}
    if not out["scale"] > 0:
        raise ValueError(f"frame: the scale must be positive, got {out['scale']}")
    return out


# -----------------------------------------------------------------------------
# cameras
# -----------------------------------------------------------------------------
class _Camera:
    """An orthographic camera: screen right, screen up, and ``back`` towards the camera."""

    def __init__(self, back: Any, right: Any = None, label: str | None = None):
        b = np.asarray(back, dtype=np.float64)
        if not np.isfinite(b).all() or np.linalg.norm(b) < 1e-12:
            raise ValueError(f"view: the direction {tuple(float(c) for c in b)} has no length")
        b = b / np.linalg.norm(b)
        if right is None:
            r = np.cross([0.0, 0.0, 1.0], b)
            if np.linalg.norm(r) < 1e-9:  # straight down or up: X stays to the right
                r = np.array([1.0, 0.0, 0.0])
        else:
            r = np.asarray(right, dtype=np.float64)
            r = r - b * (r @ b)
        r = r / np.linalg.norm(r)
        u = np.cross(b, r)
        self.back, self.right, self.up = b, r, u / np.linalg.norm(u)
        self.label = label

    @classmethod
    def of(cls, view: Any) -> _Camera:
        if isinstance(view, str):
            name = view.strip().lower()
            if name not in _TURNTABLE:
                raise ValueError(f"unknown view {view!r}; the names are {', '.join(_TURNTABLE)} and 'sheet'")
            cam = cls.turntable(*_TURNTABLE[name])
            cam.label = name.upper()
            return cam
        if isinstance(view, dict):
            if view.get("direction") is not None:
                f = _vec3(view["direction"])
                up = _vec3(view["up"]) if view.get("up") is not None else np.array([0.0, 0.0, 1.0])
                if np.linalg.norm(f) < 1e-12:
                    raise ValueError("view: the direction has no length")
                f = f / np.linalg.norm(f)
                r = np.cross(f, up)
                return cls(-f, r if np.linalg.norm(r) > 1e-3 * np.linalg.norm(up) else None)
            if "azimuth" in view or "elevation" in view:
                return cls.turntable(float(view.get("azimuth") or 0.0), float(view.get("elevation") or 0.0))
            raise ValueError(f"view: a dict needs azimuth and elevation, or a direction; got {view!r}")
        return cls(_vec3(view))

    @classmethod
    def turntable(cls, azimuth: float, elevation: float) -> _Camera:
        a = math.radians(azimuth)
        return cls(_towards_camera(azimuth, elevation), (math.cos(a), math.sin(a), 0.0))

    def project(self, p: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        return p @ self.right, p @ self.up, p @ self.back


def _fit(scene: _Scene, cam: _Camera, w: int, h: int, zoom: float = 1.0, look_at: Any = None) -> dict[str, float]:
    """The frame that fits the scene into w x h pixels."""
    if not zoom > 0:
        raise ValueError(f"zoom must be positive, got {zoom!r}")
    x, y, _ = cam.project(scene.points)
    span_x, span_y = max(float(np.ptp(x)), 1e-9), max(float(np.ptp(y)), 1e-9)
    scale = min(w * _FIT / span_x, h * _FIT / span_y) * float(zoom)
    if look_at is not None:
        mx, my, _ = cam.project(_vec3(look_at))
    else:
        mx, my = (float(x.max()) + float(x.min())) / 2, (float(y.max()) + float(y.min())) / 2
    return {"scale": float(scale), "mid_x": float(mx), "mid_y": float(my)}


# -----------------------------------------------------------------------------
# scene
# -----------------------------------------------------------------------------
class _Body:
    """The triangles of one body (corner normals, one color) and its edges, in world space."""

    def __init__(self, tris: np.ndarray, norms: np.ndarray, rgb: np.ndarray, closed: bool, segs: np.ndarray,
                 mesh: Any = None, source: Any = None):
        self.tris, self.norms, self.rgb, self.closed, self.segs = tris, norms, rgb, closed, segs
        self.mesh, self.source = mesh, source  # the source keeps the Brep alive that the mesh points into
        self._adjacent: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None
        self._principal: tuple[np.ndarray, np.ndarray] | None = None

    def curvature(self, kind: str) -> np.ndarray:
        """Curvature of the exact surface at every triangle corner, (n, 3); NaN where there is
        no exact surface (a mesh)."""
        if self._principal is None:
            self._principal = _corner_curvatures(self.mesh, self.source, len(self.tris))
        k1, k2 = self._principal
        return {"gaussian": k1 * k2, "mean": (k1 + k2) / 2, "max": k1, "min": k2}[kind]

    def adjacency(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Mesh edges shared by exactly two triangles: the two triangles and the end points."""
        if self._adjacent is None:
            v = self.tris.reshape(-1, 3)
            size = float(np.abs(v).max()) if len(v) else 1.0
            _, first, ids = np.unique(np.round(v / max(size * 1e-9, 1e-300)), axis=0, return_index=True,
                                      return_inverse=True)
            ids = ids.reshape(-1, 3)
            e = np.concatenate([ids[:, [0, 1]], ids[:, [1, 2]], ids[:, [2, 0]]])
            tri = np.tile(np.arange(len(ids)), 3)
            e.sort(axis=1)
            ok = e[:, 0] != e[:, 1]
            e, tri = e[ok], tri[ok]
            code = e[:, 0] * (len(first) + 1) + e[:, 1]
            order = np.argsort(code, kind="stable")
            code, e, tri = code[order], e[order], tri[order]
            start = np.ones(len(code), dtype=bool)
            start[1:] = code[1:] != code[:-1]
            pos = np.flatnonzero(start)
            count = np.diff(np.append(pos, len(code)))
            two = pos[count == 2]
            self._adjacent = (tri[two], tri[two + 1], v[first[e[two]]])
        return self._adjacent


class _Scene:
    """Bodies, curves drawn on top, highlights, and the points that count for the fit."""

    def __init__(self, shapes: Any, tolerance: float | None, colors: str, fine: bool = False):
        from .colors import to_rgb
        from .exporters import _DEFAULT_COLORS, _curve_points, _edge_polylines, _flatten_all
        from .mesh import Mesh, tessellate
        from .shapes import Edge, Face, Part, Sketch, Wire, _Body as Solidish

        self.bodies: list[_Body] = []
        self.overlays: list[tuple[np.ndarray, np.ndarray]] = []  # (segments, color), drawn on top
        self.items: list[Any] = []  # the shapes whose faces highlight_at searches
        self.hl_tris: list[tuple[np.ndarray, np.ndarray]] = []
        self.hl_segs: list[np.ndarray] = []
        self.hl_points: list[np.ndarray] = []
        self.tolerance = tolerance
        self._axes: list[tuple[np.ndarray, np.ndarray, float, float, float]] | None = None
        items = _flatten_all(shapes)
        solids = any(isinstance(it, (Mesh, Face)) or (isinstance(it, Solidish) and not isinstance(it, Sketch))
                     for it in items)
        palette = [np.array(to_rgb(c)) for c in _DEFAULT_COLORS]
        for i, item in enumerate(items):
            own = getattr(item, "color", None)
            native = np.array(to_rgb(own)) if own is not None else palette[i % len(palette)]
            if isinstance(item, (Edge, Wire)):
                self.overlays.append((_segments(_curve_points(item)), native * 0.75))
                continue
            if isinstance(item, Sketch) and solids:  # a sketch over solids: its curves on top
                color = np.array(to_rgb(own)) if own is not None else _OVERLAY
                self.overlays.append((_segments(_edge_polylines(item)), color))
                continue
            if isinstance(item, Mesh):
                pieces, closed = [item], item.is_closed()
            elif isinstance(item, Part):
                pieces = list(item.solids()) or [item]
                closed = item.is_valid()
            elif isinstance(item, (Solidish, Face)):
                pieces, closed = [item], False
            else:
                continue
            self.items.append(item)
            for piece in pieces:
                rgb = palette[len(self.bodies) % len(palette)] if colors == "distinct" else native
                # zebra stripes and curvature maps follow the normals closely: finer triangles
                source = piece.to_shell() if isinstance(piece, Face) and fine else piece
                mesh = piece if isinstance(piece, Mesh) else tessellate(source, tolerance, 5.0 if fine else 15.0)
                if isinstance(piece, Mesh):
                    segs = np.zeros((0, 2, 3))
                elif isinstance(piece, Face):
                    segs = _segments(_curve_points(piece))
                else:
                    segs = _segments(_edge_polylines(piece))
                if len(mesh.triangles) == 0:
                    if len(segs):
                        self.overlays.append((segs, _EDGE))
                    continue
                v = mesh.vertices[mesh.triangles]
                n = mesh.normals if mesh.normals is not None else np.repeat(mesh.triangle_normals[:, None], 3, axis=1)
                self.bodies.append(_Body(v, np.asarray(n, dtype=np.float64), rgb, closed, segs, mesh,
                                         None if isinstance(piece, Mesh) else source))
        pts = [b.tris.reshape(-1, 3) for b in self.bodies] + [b.segs.reshape(-1, 3) for b in self.bodies]
        pts += [s.reshape(-1, 3) for s, _ in self.overlays]
        allp = np.concatenate(pts) if pts else np.zeros((0, 3))
        if len(allp) == 0:
            raise ValueError("nothing to render")
        self.points = allp
        tri_pts = np.concatenate([b.tris.reshape(-1, 3) for b in self.bodies]) if self.bodies else allp
        self.lo, self.hi = tri_pts.min(axis=0), tri_pts.max(axis=0)
        self.diagonal = float(np.linalg.norm(allp.max(axis=0) - allp.min(axis=0))) or 1.0

    def curvature_range(self, kind: str, span: tuple[float, float] | None) -> tuple[float, float]:
        """The range of a curvature map: the given one, or the values on the bodies; it always
        holds zero, the white of the map."""
        if span is None:
            values = np.concatenate([b.curvature(kind).reshape(-1) for b in self.bodies]) if self.bodies else np.zeros(0)
            values = values[np.isfinite(values)]
            span = (float(values.min()), float(values.max())) if len(values) else (0.0, 0.0)
            # a side under a thousandth of the other is noise (a plane, the end of a blend): zero
            noise = 1e-3 * max(abs(span[0]), abs(span[1]))
            span = (span[0] if span[0] < -noise else 0.0, span[1] if span[1] > noise else 0.0)
        return min(span[0], 0.0), max(span[1], 0.0)

    def axes(self) -> list[tuple[np.ndarray, np.ndarray, float, float, float]]:
        """The axes of round features, for center lines: from the circles and arcs of at least
        half a turn among the edges, one entry per axis line with a point on it, its
        direction, the range of the circles along it and their largest radius."""
        if self._axes is None:
            found: dict[tuple[Any, ...], list[Any]] = {}
            q = self.diagonal * 1e-6
            for item in self.items:
                if not hasattr(item, "edges"):
                    continue
                for e in item.edges():
                    circle = _circle_of(e)
                    if circle is None:
                        continue
                    c, d, r = circle
                    d = d / np.linalg.norm(d)
                    d = d if d[np.argmax(np.abs(d))] > 0 else -d
                    foot = c - (c @ d) * d  # the point of the axis line nearest the origin
                    key = (*np.round(d, 6), *np.round(foot / q))
                    entry = found.setdefault(key, [foot, d, np.inf, -np.inf, 0.0])
                    t = float(c @ d)
                    entry[2], entry[3], entry[4] = min(entry[2], t), max(entry[3], t), max(entry[4], r)
            self._axes = [(f, d, t0, t1, r) for f, d, t0, t1, r in found.values()]
        return self._axes

    def add_highlights(self, highlight: Any, highlight_at: Any) -> None:
        from .exporters import _curve_points, _flatten_all
        from .mesh import Mesh, tessellate
        from .shapes import Edge, Face, Shape, Vertex, Wire, _Body as Solidish

        tol = self.tolerance if self.tolerance is not None else self.diagonal * 1e-3
        faces: list[Any] = []
        if highlight is not None:
            items = highlight if isinstance(highlight, (list, tuple)) else [highlight]
            bad = [type(s).__name__ for s in items if not isinstance(s, (Shape, Mesh, list, tuple))]
            if bad:
                raise TypeError(f"highlight takes shapes or lists of them, got {bad[0]}")
            for s in _flatten_all(items):
                if isinstance(s, Vertex):
                    self.hl_points.append(_vec3(s))
                elif isinstance(s, (Edge, Wire)):
                    self.hl_segs.append(_segments(_curve_points(s)))
                elif isinstance(s, Face):
                    faces.append(s)
                elif isinstance(s, Mesh):
                    self._add_mesh(s)
                elif isinstance(s, Solidish):
                    self._add_mesh(tessellate(s, tol))
                elif not isinstance(s, Shape):
                    raise TypeError(f"highlight takes shapes, got {type(s).__name__}")
        if highlight_at is not None:
            candidates = [f for item in self.items if hasattr(item, "faces") for f in item.faces()]
            for p in [highlight_at] if _is_point(highlight_at) else list(highlight_at):
                q = tuple(_vec3(p))
                if candidates:
                    faces.append(min(candidates, key=lambda f: f.distance_to(q)))
        for f in faces:
            self._add_mesh(tessellate(f, tol))

    def _add_mesh(self, mesh: Any) -> None:
        if len(mesh.triangles):
            n = mesh.normals if mesh.normals is not None else np.repeat(mesh.triangle_normals[:, None], 3, axis=1)
            self.hl_tris.append((mesh.vertices[mesh.triangles], np.asarray(n, dtype=np.float64)))


def _circle_of(edge: Any) -> tuple[np.ndarray, np.ndarray, float] | None:
    """Center, axis and radius of an edge that is a circle or an arc of at least half a turn,
    also when the kernel made it a B-spline (chamfers, revolved profiles); else None."""
    try:
        kind = edge.geom_type
        if kind == "circle":
            r = edge.radius
            if edge.length < np.pi * r * (1 - 1e-6):
                return None
            return np.array(edge.arc_center.to_tuple()), np.array(edge.normal.to_tuple()), float(r)
        if kind != "bspline":
            return None
        pts = np.array([edge.point_at(t).to_tuple() for t in np.linspace(0, 1, 9)])
    except Exception:  # an edge the kernel cannot describe
        return None
    a, ab, ac = pts[0], pts[3] - pts[0], pts[6] - pts[0]
    n = np.cross(ab, ac)
    nn = float(n @ n)
    if nn < 1e-24:
        return None
    c = a + (np.cross(n, ab) * (ac @ ac) + np.cross(ac, n) * (ab @ ab)) / (2 * nn)
    r = float(np.linalg.norm(a - c))
    d = n / np.sqrt(nn)
    off_circle = np.abs(np.linalg.norm(pts - c, axis=1) - r).max()
    off_plane = np.abs((pts - c) @ d).max()
    if max(off_circle, off_plane) > 1e-4 * r or edge.length < np.pi * r * (1 - 1e-4):
        return None
    return c, d, r


def _corner_curvatures(mesh: Any, source: Any, count: int) -> tuple[np.ndarray, np.ndarray]:
    """Principal curvatures (k1 >= k2) at the triangle corners of a tessellation, from the exact
    surfaces (the kernel evaluates their fundamental forms). NaN where there is none."""
    from ._kernel import ext
    from .mesh import _triangulate

    missing = np.full((count, 3), np.nan)
    poly = getattr(getattr(mesh, "_poly", None), "poly", None)
    if poly is None or source is None:
        return missing, missing
    r = ext.poly_curvatures(poly)
    faces = np.asarray(poly.to_numpy_arrays(face_varying_normals=True)["faces"], dtype=np.int64)
    tris, corner = _triangulate(faces)
    k1, k2 = np.asarray(r["k1"]), np.asarray(r["k2"])
    if len(tris) != count or len(k1) != corner.max(initial=-1) + 1:
        return missing, missing  # not the corner order of the mesh: leave it out rather than guess
    return k1[corner], k2[corner]


def _segments(polylines: list[np.ndarray]) -> np.ndarray:
    segs = [np.stack([pl[:-1], pl[1:]], axis=1) for pl in polylines if len(pl) >= 2]
    return np.concatenate(segs) if segs else np.zeros((0, 2, 3))


# -----------------------------------------------------------------------------
# one view
# -----------------------------------------------------------------------------
class _Canvas:
    """The supersampled picture of one view: colors, depth buffer, the texts to draw."""

    def __init__(self, w: int, h: int, k: int, cam: _Camera, frame: dict[str, float], bg: np.ndarray):
        self.w, self.h, self.k = w, h, k
        self.W, self.H = w * k, h * k
        self.cam = cam
        self.s = frame["scale"] * k
        self.mx, self.my = frame["mid_x"], frame["mid_y"]
        self.img = np.empty((self.W * self.H, 3), dtype=np.float32)
        self.img[:] = bg
        self.zbuf = np.full(self.W * self.H, -np.inf)
        self.u = max(1, round(min(w, h) / 600))  # overlays grow with large pictures
        self.texts: list[tuple[float, float, str, np.ndarray, int, str, np.ndarray | None]] = []

    def screen(self, p: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        x, y, z = self.cam.project(p)
        return self.W / 2.0 + (x - self.mx) * self.s, self.H / 2.0 - (y - self.my) * self.s, z

    def text(self, x: float, y: float, text: str, color: np.ndarray, scale: int = 2, anchor: str = "start",
             halo: np.ndarray | None = None) -> None:
        """Text in output pixels; drawn after averaging down, so the glyphs stay crisp."""
        self.texts.append((x, y, text, color, scale, anchor, halo))

    def finish(self) -> np.ndarray:
        k = self.k
        img = self.img.reshape(self.H, self.W, 3)
        if k > 1:  # average k x k blocks
            big = img
            img = np.zeros((self.h, self.w, 3))
            for dy in range(k):
                for dx in range(k):
                    img += big[dy::k, dx::k]
            img /= k * k
        for x, y, text, color, scale, anchor, halo in self.texts:
            _text(img, x, y, text, color, scale, anchor, halo)
        return img


def _view(scene: _Scene, cam: _Camera, w: int, h: int, o: _Options, frame: dict[str, float]) -> np.ndarray:
    cv = _Canvas(w, h, o.k, cam, frame, o.bg)
    k, cut = o.k, o.section
    depth = float(np.ptp(scene.points @ cam.back)) or 1.0
    eps = max(depth * 2e-3, 2.5 / cv.s)  # depth that still counts as "on the surface"

    # the triangles of all bodies (clipped by the section), then the highlighted faces
    parts: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]] = []  # tris, normals, colors, shade factor
    caps: list[tuple[np.ndarray, np.ndarray, int]] = []  # cut outline, body color, body index
    outlines: list[np.ndarray] = []
    for bi, body in enumerate(scene.bodies):
        tris, norms = body.tris, body.norms
        if o.curvature is not None:  # the curvature rides along with the normals, through the clipping
            norms = np.concatenate([norms, body.curvature(o.curvature[0])[..., None]], axis=2)
        if cut is not None:
            if body.closed:
                outline = _crossings(tris, cut)
                outlines.append(outline)
                if cut.cap and not o.xray and len(outline):
                    caps.append((outline, body.rgb, bi))
            tris, norms = _clip(tris, norms, cut)
        if not len(tris):
            continue
        facing = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]) @ cam.back
        factor = np.ones(len(tris))
        if body.closed:
            if cut is None:
                keep = facing >= 0  # the back of a solid is never seen
                tris, norms, factor = tris[keep], norms[keep], factor[keep]
            else:
                factor[facing < 0] = 0.72  # inside walls the cut lays open
        parts.append((tris, norms, np.repeat(body.rgb[None], len(tris), axis=0), factor))
    n_body = sum(len(p[0]) for p in parts)
    for tris, norms in scene.hl_tris:
        if o.curvature is not None:
            norms = np.concatenate([norms, np.full(norms.shape[:2] + (1,), np.nan)], axis=2)
        if cut is not None:
            tris, norms = _clip(tris, norms, cut)
        if len(tris) and cut is None:
            keep = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]) @ cam.back >= 0
            tris, norms = tris[keep], norms[keep]
        if len(tris):
            parts.append((tris, norms, np.repeat(_ORANGE[None], len(tris), axis=0), np.ones(len(tris))))
    if parts:
        tris = np.concatenate([p[0] for p in parts])
        norms = np.concatenate([p[1] for p in parts])
        rgb = np.concatenate([p[2] for p in parts])
        factor = np.concatenate([p[3] for p in parts])
    else:
        columns = 4 if o.curvature is not None else 3
        tris, norms, rgb, factor = np.zeros((0, 3, 3)), np.zeros((0, 3, columns)), np.zeros((0, 3)), np.zeros(0)
    sx, sy, sz = cv.screen(tris.reshape(-1, 3))
    sx, sy, sz = sx.reshape(-1, 3), sy.reshape(-1, 3), sz.reshape(-1, 3).copy()
    sz[n_body:] += 3 * eps  # highlighted faces win over the body they lie on
    tri = _Triangles(sx, sy, sz, norms, rgb, factor, cam, n_body)

    if o.xray:
        _xray(cv, tri, o)
    else:
        tbuf = _depth_fill(cv, tri)
        n_tri = len(rgb)
        for ci, (outline, _, _) in enumerate(caps):
            _cap_fill(cv, tbuf, outline, cut, n_tri + ci)  # type: ignore[arg-type]
        _shade(cv, tbuf, tri, o, n_body, [(c[1], c[2]) for c in caps])

    # lines: B-rep edges, silhouettes (line style), the outlines of the cut
    ink = _INK if o.lines else _ZEBRA_EDGE if o.zebra else _EDGE
    segs: list[np.ndarray] = []
    if o.edges or o.lines:
        segs += [b.segs if cut is None else _clip_segments(b.segs, cut) for b in scene.bodies]
        segs += outlines
    if o.lines:
        segs += [_silhouettes(b, cam) if cut is None else _clip_segments(_silhouettes(b, cam), cut)
                 for b in scene.bodies]
    edge_segs = _join(segs)
    hl = _join([s if cut is None else _clip_segments(s, cut) for s in scene.hl_segs])
    edge_cols = np.repeat(ink[None], len(edge_segs), axis=0)
    hl_cols = np.repeat(_RED[None], len(hl), axis=0)
    if o.lines:
        near = _min_filter(cv.zbuf.reshape(cv.H, cv.W), k).reshape(-1)
        both = np.concatenate([edge_segs, hl])
        hidden = np.concatenate([np.repeat(_HIDDEN_INK[None], len(edge_segs), axis=0), hl_cols])
        _lines(cv, both, hidden, 0.5 * k, "hidden", near, eps)  # hidden first, thin and dashed
        _center_lines(cv, scene, cut)
        _lines(cv, both, np.concatenate([edge_cols, hl_cols]), 1.0 * k, "visible", near, eps)
    elif o.xray:
        _lines(cv, edge_segs, edge_cols, 0.5 * k, "all")
        _lines(cv, hl, hl_cols, 0.9 * k, "all")
    else:
        _lines(cv, edge_segs, edge_cols, 0.5 * k, "depth", cv.zbuf, eps)
        _lines(cv, hl, hl_cols, 0.9 * k, "depth", cv.zbuf, 4 * eps)

    for s, color in scene.overlays:
        _lines(cv, s, np.repeat(color[None], len(s), axis=0), 0.6 * k, "all")
    for p in scene.hl_points:
        _dot(cv, p, _RED, 3.5)
    for pos, label, color in o.markers:
        _marker(cv, pos, label, color)
    if o.annotate:
        _annotate(cv, scene)
    if o.curvature is not None and o.legend and not o.lines:
        _legend(cv, *o.curvature)
    return cv.finish()


def _join(segs: list[np.ndarray]) -> np.ndarray:
    segs = [s for s in segs if len(s)]
    return np.concatenate(segs) if segs else np.zeros((0, 2, 3))


class _Triangles:
    """Triangles on the screen with what the fill and the shading need: the maps from a pixel
    to barycentric coordinates and depth, normals in camera coordinates, colors."""

    def __init__(self, sx: np.ndarray, sy: np.ndarray, sz: np.ndarray, norms: np.ndarray, rgb: np.ndarray,
                 factor: np.ndarray, cam: _Camera, n_body: int = -1):
        x0, x1, x2 = sx[:, 0], sx[:, 1], sx[:, 2]
        y0, y1, y2 = sy[:, 0], sy[:, 1], sy[:, 2]
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        self.ok = np.abs(area) > 1e-9
        a = np.where(self.ok, area, 1.0)[:, None]
        # barycentric coordinate i at pixel (x, y): bx[:, i] * x + by[:, i] * y + b0[:, i]
        self.bx = np.stack([y1 - y2, y2 - y0, y0 - y1], axis=1) / a
        self.by = np.stack([x2 - x1, x0 - x2, x1 - x0], axis=1) / a
        self.b0 = np.stack([x1 * y2 - x2 * y1, x2 * y0 - x0 * y2, x0 * y1 - x1 * y0], axis=1) / a
        self.sx, self.sy = sx, sy
        self.zx, self.zy, self.z0 = (self.bx * sz).sum(1), (self.by * sz).sum(1), (self.b0 * sz).sum(1)
        # the normal (camera coordinates) at a pixel: nx * x + ny * y + n0
        ncam = norms[..., :3] @ np.stack([cam.right, cam.up, cam.back], axis=1)
        self.nx = np.einsum("ti,tij->tj", self.bx, ncam)
        self.ny = np.einsum("ti,tij->tj", self.by, ncam)
        self.n0 = np.einsum("ti,tij->tj", self.b0, ncam)
        # a value per corner (the curvature), the same way: vx * x + vy * y + v0
        self.has_value = norms.shape[-1] > 3
        if self.has_value:
            value = norms[..., 3]
            self.vx, self.vy, self.v0 = (self.bx * value).sum(1), (self.by * value).sum(1), (self.b0 * value).sum(1)
        self.rgb, self.factor = rgb, factor
        self.n_body = len(rgb) if n_body < 0 else n_body  # triangles from here on are highlights
        self.cam = cam

    def depth(self, t: np.ndarray, xc: np.ndarray, yc: np.ndarray) -> np.ndarray:
        return self.zx[t] * xc + self.zy[t] * yc + self.z0[t]


def _expand(start: np.ndarray, count: np.ndarray) -> np.ndarray:
    """start[i], start[i] + 1, ... (count[i] values) for every i, concatenated."""
    total = int(count.sum())
    return np.repeat(start, count) + (np.arange(total) - np.repeat(np.cumsum(count) - count, count))


def _fragments(tri: _Triangles, W: int, H: int, budget: int = 1 << 22):
    """The pixels whose centers lie in the triangles, as chunks of (triangle, pixel index)."""
    sx, sy = tri.sx, tri.sy
    ok = tri.ok & (sx.max(axis=1) >= 0) & (sx.min(axis=1) <= W) & (sy.max(axis=1) >= 0) & (sy.min(axis=1) <= H)
    ids = np.flatnonzero(ok)
    if not len(ids):
        return
    r0 = np.maximum(np.ceil(sy[ids].min(axis=1) - 0.5), 0).astype(np.int64)
    r1 = np.minimum(np.floor(sy[ids].max(axis=1) - 0.5), H - 1).astype(np.int64)
    nr = np.maximum(r1 - r0 + 1, 0)
    cum = np.cumsum(nr)
    start = 0
    while start < len(ids):
        base = cum[start - 1] if start else 0
        stop = max(int(np.searchsorted(cum, base + budget // 4, side="right")), start + 1)
        t = np.repeat(ids[start:stop], nr[start:stop])
        rows = _expand(r0[start:stop], nr[start:stop])
        yc = rows + 0.5
        # the span of each row: where every barycentric coordinate is >= 0 (a little less, so
        # that no pixel falls between two triangles)
        lo = np.full(len(t), -np.inf)
        hi = np.full(len(t), np.inf)
        for i in range(3):
            ax = tri.bx[t, i]
            v = tri.by[t, i] * yc + tri.b0[t, i] + 1e-7
            with np.errstate(divide="ignore", invalid="ignore"):
                bound = -v / ax
            lo = np.where(ax > 0, np.maximum(lo, bound), lo)
            hi = np.where(ax < 0, np.minimum(hi, bound), hi)
            hi = np.where((ax == 0) & (v < 0), -np.inf, hi)
        c0 = np.maximum(np.ceil(lo - 0.5), 0)
        c1 = np.minimum(np.floor(hi - 0.5), W - 1)
        nc = np.maximum(c1 - c0 + 1, 0).astype(np.int64)
        keep = nc > 0
        t, rows, c0, nc = t[keep], rows[keep], c0[keep].astype(np.int64), nc[keep]
        ccum = np.cumsum(nc)
        s = 0
        while s < len(t):
            b = ccum[s - 1] if s else 0
            e = max(int(np.searchsorted(ccum, b + budget, side="right")), s + 1)
            m = nc[s:e]
            yield np.repeat(t[s:e], m), np.repeat(rows[s:e], m) * W + _expand(c0[s:e], m)
            s = e
        start = stop


def _centers(pix: np.ndarray, W: int) -> tuple[np.ndarray, np.ndarray]:
    return (pix % W) + 0.5, (pix // W) + 0.5


def _depth_fill(cv: _Canvas, tri: _Triangles) -> np.ndarray:
    """The depth test: per pixel the nearest triangle (-1: none)."""
    tbuf = np.full(cv.W * cv.H, -1, dtype=np.int32)
    for t, pix in _fragments(tri, cv.W, cv.H):
        xc, yc = _centers(pix, cv.W)
        z = tri.depth(t, xc, yc)
        np.maximum.at(cv.zbuf, pix, z)
        win = z >= cv.zbuf[pix]
        tbuf[pix[win]] = t[win]
    return tbuf


def _lighting(n: np.ndarray, rgb: np.ndarray, factor: np.ndarray) -> np.ndarray:
    """Colors for normals in camera coordinates: a key light from the upper left, a fill
    light, ambient and a little specular. Both sides of a surface are lit."""
    n = n / np.maximum(np.sqrt((n * n).sum(axis=1, keepdims=True)), 1e-12)
    n *= np.where(n[:, 2:3] < 0, -1.0, 1.0)
    key = _unit(np.array([-0.45, 0.65, 0.9]))
    fill = _unit(np.array([0.6, -0.2, 0.8]))
    half = _unit(key + np.array([0.0, 0.0, 1.0]))
    diff = np.clip(n @ key, 0, 1)
    spec = np.clip(n @ half, 0, 1) ** 40
    light = 0.30 + 0.62 * diff + 0.16 * np.clip(n @ fill, 0, 1)
    return (rgb * light[:, None] + 0.10 * spec[:, None]) * factor[:, None]


def _shade_pixels(tri: _Triangles, t: np.ndarray, pix: np.ndarray, W: int, o: _Options) -> np.ndarray:
    """Per pixel: the normal interpolated over the triangle (from the exact normals at its
    corners), then lit, striped (zebra) or colored by curvature."""
    xc, yc = _centers(pix, W)
    n = tri.nx[t] * xc[:, None] + tri.ny[t] * yc[:, None] + tri.n0[t]
    if o.zebra and not o.lines:
        return _zebra(n, tri, t, o.zebra)
    if o.curvature is not None and not o.lines:
        value = tri.vx[t] * xc + tri.vy[t] * yc + tri.v0[t]
        colors = _curvature_colors(n, value, o.curvature[1], o.curvature[2], tri.factor[t])
        hl = t >= tri.n_body  # highlighted faces stay orange
        if hl.any():
            colors[hl] = _lighting(n[hl], tri.rgb[t[hl]], tri.factor[t[hl]])
        return colors
    return _lighting(n, tri.rgb[t], tri.factor[t])


def _zebra(n: np.ndarray, tri: _Triangles, t: np.ndarray, spec: dict[str, Any]) -> np.ndarray:
    """Stripes: the reflection of parallel light lines at infinity. The view ray, reflected at
    the surface, points to one of the lines or between two; which, depends on its angle
    around the direction of the lines."""
    n = n / np.maximum(np.sqrt((n * n).sum(axis=1, keepdims=True)), 1e-12)
    n *= np.where(n[:, 2:3] < 0, -1.0, 1.0)
    r = 2 * n[:, 2:3] * n - np.array([0.0, 0.0, 1.0])  # the view ray (towards -z), reflected
    direction = spec["direction"]
    if isinstance(direction, str):
        d = np.array([0.0, 1.0, 0.0]) if direction == "vertical" else np.array([1.0, 0.0, 0.0])
    else:
        cam = tri.cam
        d = np.array([direction @ cam.right, direction @ cam.up, direction @ cam.back])
    d = d / np.linalg.norm(d)
    e2 = np.array([0.0, 0.0, 1.0]) - d * d[2]  # the view direction, square to the light lines
    if np.linalg.norm(e2) < 1e-6:
        e2 = np.cross(d, [1.0, 0.0, 0.0]) if abs(d[0]) < 0.9 else np.cross(d, [0.0, 1.0, 0.0])
    e2 = e2 / np.linalg.norm(e2)
    e1 = np.cross(d, e2)
    angle = np.arctan2(r @ e1, r @ e2)
    dark = ((angle / (2 * np.pi) * spec["stripes"]) % 1.0) < spec["width"]
    light = np.where((t >= tri.n_body)[:, None], _ORANGE, _ZEBRA_LIGHT)  # highlighted faces: orange and black
    color = np.where(dark[:, None], _ZEBRA_DARK, light)
    # towards the direction of the lines the stripes crowd together and have no angle: gray
    pole = np.clip((np.abs(r @ d) - 0.95) / 0.04, 0, 1)[:, None]
    color = color * (1 - pole) + 0.5 * pole
    return color * tri.factor[t][:, None]


def _curvature_colors(n: np.ndarray, value: np.ndarray, lo: float, hi: float, factor: np.ndarray) -> np.ndarray:
    """The color map at the values, lightly shaded so that the shape still reads; gray where a
    value is missing."""
    rgb = _curvature_map(_curvature_position(value, lo, hi))
    rgb[~np.isfinite(value)] = 0.6
    n = n / np.maximum(np.sqrt((n * n).sum(axis=1, keepdims=True)), 1e-12)
    n *= np.where(n[:, 2:3] < 0, -1.0, 1.0)
    diff = np.clip(n @ _unit(np.array([-0.45, 0.65, 0.9])), 0, 1)
    return rgb * (0.62 + 0.38 * diff)[:, None] * factor[:, None]


def _curvature_position(value: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Where a value lies on the map: 0.5 is zero, 1 the top of the range, 0 the bottom."""
    v = np.nan_to_num(np.asarray(value, dtype=np.float64))
    up = np.clip(v / hi, 0, 1) if hi > 0 else np.zeros_like(v)
    down = np.clip(v / lo, 0, 1) if lo < 0 else np.zeros_like(v)
    return 0.5 + 0.5 * np.where(v >= 0, up, -down)


def _curvature_map(position: np.ndarray) -> np.ndarray:
    stops, colors = _CURVATURE_MAP
    return np.stack([np.interp(position, stops, colors[:, c]) for c in range(3)], axis=-1)


def _legend(cv: _Canvas, kind: str, lo: float, hi: float) -> None:
    """The scale of a curvature map at the right edge: a color bar from the lowest to the
    highest value, with zero, the unit and the kind."""
    k, u, w, h = cv.k, cv.u, cv.w, cv.h
    x1 = w - 14 * u
    x0 = x1 - 12 * u
    y0 = 40 * u
    y1 = y0 + min(int(0.42 * h), 220 * u)
    rows = np.arange(y0 * k, y1 * k)
    top, bottom = (1.0 if hi > 0 else 0.5), (0.0 if lo < 0 else 0.5)  # the part of the map in use
    colors = _curvature_map(top - (top - bottom) * (rows - y0 * k + 0.5) / ((y1 - y0) * k))
    img = cv.img.reshape(cv.H, cv.W, 3)
    img[y0 * k:y1 * k, x0 * k:x1 * k] = colors[:, None, :]
    frame = [(x0 * k, y0 * k, x1 * k, y0 * k), (x1 * k, y0 * k, x1 * k, y1 * k), (x1 * k, y1 * k, x0 * k, y1 * k),
             (x0 * k, y1 * k, x0 * k, y0 * k)]
    _screen_lines(cv, frame, _LABEL, 0.5 * k)
    unit = "1/MM²" if kind == "gaussian" else "1/MM"
    cv.text(x1, y0 - 12 * u - 7 * u, f"{kind.upper()} {unit}", _LABEL, u, "end", halo=_WHITE)
    ticks = [(hi, y0), (lo, y1)] if hi > lo else [(0.0, (y0 + y1) / 2)]
    if lo < 0 < hi:
        ticks.append((0.0, (y0 + y1) / 2))
    for value, y in ticks:
        cv.text(x0 - 5 * u, y - 3.5 * u, _value_text(value), _LABEL, u, "end", halo=_WHITE)
        _screen_lines(cv, [((x0 - 3 * u) * k, y * k, x0 * k, y * k)], _LABEL, 0.5 * k)


def _value_text(v: float) -> str:
    if v == 0:
        return "0"
    return f"{v:.3g}".replace("e-0", "e-").replace("e+0", "e")


def _shade(cv: _Canvas, tbuf: np.ndarray, tri: _Triangles, o: _Options, n_body: int,
           caps: list[tuple[np.ndarray, int]]) -> None:
    n_tri = len(tri.rgb)
    pix = np.flatnonzero((tbuf >= 0) & (tbuf < n_tri))
    if o.lines:
        pix = pix[tbuf[pix] >= n_body]  # a drawing fills only highlighted faces
    step = 1 << 19
    for c0 in range(0, len(pix), step):
        p = pix[c0:c0 + step]
        cv.img[p] = _shade_pixels(tri, tbuf[p], p, cv.W, o)
    # cut faces: a light fill, hatched at 45 degrees in a dark tone of the body
    period = 7 * cv.k
    for ci, (base, bi) in enumerate(caps):
        p = np.flatnonzero(tbuf == n_tri + ci)
        if not len(p):
            continue
        x, y = p % cv.W, p // cv.W
        on = (((x - y) if bi % 2 else (x + y)) % period) < cv.k
        fill = o.bg if o.lines else 0.55 * 0.9 * base + 0.45
        ink = _HATCH_INK if o.lines else 0.27 * base
        cv.img[p] = np.where(on[:, None], ink, fill)


def _xray(cv: _Canvas, tri: _Triangles, o: _Options) -> None:
    """Every pixel of every triangle, blended over those behind it with a fixed opacity."""
    chunks = [(t, pix, tri.depth(t, *_centers(pix, cv.W))) for t, pix in _fragments(tri, cv.W, cv.H)]
    if not chunks:
        return
    t = np.concatenate([c[0] for c in chunks])
    pix = np.concatenate([c[1] for c in chunks])
    z = np.concatenate([c[2] for c in chunks])
    np.maximum.at(cv.zbuf, pix, z)
    zmin, zmax = float(z.min()), float(z.max())
    zq = ((zmax - z) / max(zmax - zmin, 1e-300) * ((1 << 30) - 1)).astype(np.int64)  # 0 = nearest
    order = np.argsort((pix << 31) | zq, kind="stable")
    pix, t, z = pix[order], t[order], z[order]
    # a pixel on the edge between two triangles is covered by both: one surface, blended once
    same = np.zeros(len(pix), dtype=bool)
    same[1:] = (pix[1:] == pix[:-1]) & (np.abs(z[1:] - z[:-1]) <= (zmax - zmin) * 1e-7 + 1e-12)
    pix, t = pix[~same], t[~same]
    first = np.ones(len(pix), dtype=bool)
    first[1:] = pix[1:] != pix[:-1]
    rank = np.arange(len(pix)) - np.flatnonzero(first)[np.cumsum(first) - 1]  # nearer ones in front
    a = o.alpha
    weight = a * (1 - a) ** rank
    step = 1 << 19
    color = np.concatenate([_shade_pixels(tri, t[i:i + step], pix[i:i + step], cv.W, o)
                            for i in range(0, len(pix), step)])
    count = np.bincount(pix, minlength=cv.W * cv.H)
    hit = count > 0
    behind = (1 - a) ** count[hit]
    for ch in range(3):
        acc = np.bincount(pix, weights=weight * color[:, ch], minlength=cv.W * cv.H)
        cv.img[hit, ch] = cv.img[hit, ch] * behind + acc[hit]


# -----------------------------------------------------------------------------
# sections
# -----------------------------------------------------------------------------
def _clip(tris: np.ndarray, norms: np.ndarray, cut: _Cut) -> tuple[np.ndarray, np.ndarray]:
    """Clip triangles to the side of the plane that stays (distance <= 0)."""
    d = cut.distance(tris.reshape(-1, 3)).reshape(-1, 3)
    pos = d > 0
    npos = pos.sum(axis=1)
    out_t, out_n = [tris[npos == 0]], [norms[npos == 0]]
    for count in (1, 2):
        sel = np.flatnonzero(npos == count)
        if not len(sel):
            continue
        # turn the corners so that the odd one (cut away for count 1, kept for count 2)
        # comes first; the corners stay counterclockwise
        odd = np.argmax(pos[sel] if count == 1 else ~pos[sel], axis=1)
        idx = (odd[:, None] + np.arange(3)[None]) % 3
        v = np.take_along_axis(tris[sel], idx[..., None], axis=1)
        nn = np.take_along_axis(norms[sel], idx[..., None], axis=1)
        dd = np.take_along_axis(d[sel], idx, axis=1)
        p01, n01 = _cross_point(v[:, 0], v[:, 1], nn[:, 0], nn[:, 1], dd[:, 0], dd[:, 1])
        p02, n02 = _cross_point(v[:, 0], v[:, 2], nn[:, 0], nn[:, 2], dd[:, 0], dd[:, 2])
        if count == 1:  # the first corner is cut away: the quad p01, v1, v2, p02 stays
            out_t += [np.stack([p01, v[:, 1], v[:, 2]], axis=1), np.stack([p01, v[:, 2], p02], axis=1)]
            out_n += [np.stack([n01, nn[:, 1], nn[:, 2]], axis=1), np.stack([n01, nn[:, 2], n02], axis=1)]
        else:  # only the first corner stays
            out_t.append(np.stack([v[:, 0], p01, p02], axis=1))
            out_n.append(np.stack([nn[:, 0], n01, n02], axis=1))
    return np.concatenate(out_t), np.concatenate(out_n)


def _cross_point(a: np.ndarray, b: np.ndarray, na: np.ndarray, nb: np.ndarray, da: np.ndarray,
                 db: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Where the segments a-b cross the plane, and the normal there. Interpolated from the end
    that stays, so that the triangles on both sides of a mesh edge get the same point."""
    swap = da > 0
    p, q = np.where(swap[:, None], b, a), np.where(swap[:, None], a, b)
    m, mq = np.where(swap[:, None], nb, na), np.where(swap[:, None], na, nb)
    dp, dq = np.where(swap, db, da), np.where(swap, da, db)
    t = (dp / (dp - dq))[:, None]
    return p + (q - p) * t, m + (mq - m) * t


def _crossings(tris: np.ndarray, cut: _Cut) -> np.ndarray:
    """The segments where the triangles cross the plane: the outline of the cut face."""
    d = cut.distance(tris.reshape(-1, 3)).reshape(-1, 3)
    pos = d > 0
    npos = pos.sum(axis=1)
    sel = np.flatnonzero((npos == 1) | (npos == 2))
    if not len(sel):
        return np.zeros((0, 2, 3))
    odd = np.where(npos[sel] == 1, np.argmax(pos[sel], axis=1), np.argmax(~pos[sel], axis=1))
    idx = (odd[:, None] + np.arange(3)[None]) % 3
    v = np.take_along_axis(tris[sel], idx[..., None], axis=1)
    dd = np.take_along_axis(d[sel], idx, axis=1)
    zero = np.zeros_like(v[:, 0])
    p01, _ = _cross_point(v[:, 0], v[:, 1], zero, zero, dd[:, 0], dd[:, 1])
    p02, _ = _cross_point(v[:, 0], v[:, 2], zero, zero, dd[:, 0], dd[:, 2])
    return np.stack([p01, p02], axis=1)


def _clip_segments(segs: np.ndarray, cut: _Cut) -> np.ndarray:
    if not len(segs):
        return segs
    da, db = cut.distance(segs[:, 0]), cut.distance(segs[:, 1])
    keep = (da <= 0) | (db <= 0)
    segs, da, db = segs[keep].copy(), da[keep], db[keep]
    for end, dself, dother in ((0, da, db), (1, db, da)):
        m = dself > 0
        if m.any():
            t = (dother[m] / (dother[m] - dself[m]))[:, None]
            other = segs[m, 1 - end]
            segs[m, end] = other + (segs[m, end] - other) * t
    return segs


def _cap_fill(cv: _Canvas, tbuf: np.ndarray, outline: np.ndarray, cut: _Cut, cap_id: int) -> None:
    """Fill the cut face inside its outline (even-odd, so holes stay open) at the depth of the
    plane."""
    cam = cv.cam
    nb = float(cut.normal @ cam.back)
    if abs(nb) < 1e-6:
        return  # the plane is seen edge-on: the cut is only its outline
    ax, ay, _ = cv.screen(outline[:, 0])
    bx, by, _ = cv.screen(outline[:, 1])
    lo, hi = np.minimum(ay, by), np.maximum(ay, by)
    r0 = np.maximum(np.ceil(lo - 0.5), 0).astype(np.int64)
    r1 = np.minimum(np.ceil(hi - 0.5) - 1, cv.H - 1).astype(np.int64)
    n = np.maximum(r1 - r0 + 1, 0)
    s = np.repeat(np.arange(len(outline)), n)
    rows = _expand(r0, n)
    if not len(rows):
        return
    x = ax[s] + (rows + 0.5 - ay[s]) * (bx[s] - ax[s]) / (by[s] - ay[s])
    order = np.lexsort((x, rows))
    rows, x = rows[order], x[order]
    first = np.ones(len(rows), dtype=bool)
    first[1:] = rows[1:] != rows[:-1]
    rank = np.arange(len(rows)) - np.flatnonzero(first)[np.cumsum(first) - 1]
    same_next = np.append(rows[1:] == rows[:-1], False)
    i = np.flatnonzero((rank % 2 == 0) & same_next)  # pairs of crossings on a row: inside between them
    c0 = np.maximum(np.ceil(x[i] - 0.5), 0).astype(np.int64)
    c1 = np.minimum(np.ceil(x[i + 1] - 0.5) - 1, cv.W - 1).astype(np.int64)
    m = np.maximum(c1 - c0 + 1, 0)
    cols = _expand(c0, m)
    pr = np.repeat(rows[i], m)
    pix = pr * cv.W + cols
    # the depth of the plane at each pixel
    xp = cv.mx + (cols + 0.5 - cv.W / 2) / cv.s
    yp = cv.my - (pr + 0.5 - cv.H / 2) / cv.s
    d0 = float(cut.normal @ cut.origin)
    z = (d0 - xp * float(cut.normal @ cam.right) - yp * float(cut.normal @ cam.up)) / nb
    win = z >= cv.zbuf[pix]
    cv.zbuf[pix[win]] = z[win]
    tbuf[pix[win]] = cap_id


# -----------------------------------------------------------------------------
# lines
# -----------------------------------------------------------------------------
def _silhouettes(body: _Body, cam: _Camera) -> np.ndarray:
    """Mesh edges between a triangle that faces the camera and one that does not: the outline
    of curved faces, where they have no B-rep edge."""
    t0, t1, ends = body.adjacency()
    if not len(t0):
        return np.zeros((0, 2, 3))
    front = body.norms.sum(axis=1) @ cam.back > 1e-9
    return ends[front[t0] != front[t1]]


def _min_filter(z: np.ndarray, r: int) -> np.ndarray:
    """The farthest depth within r pixels (a square); beyond the border there is nothing."""
    out = z
    for axis in (0, 1):
        src = out if axis == 0 else out.T
        acc = src.copy()
        for d in range(1, r + 1):
            np.minimum(acc[d:], src[:-d], out=acc[d:])
            np.minimum(acc[:-d], src[d:], out=acc[:-d])
        acc[:r] = -np.inf
        acc[-r:] = -np.inf
        out = acc if axis == 0 else acc.T
    return np.ascontiguousarray(out)


def _disc(r: float) -> np.ndarray:
    m = int(math.floor(r))
    g = np.arange(-m, m + 1)
    dx, dy = np.meshgrid(g, g)
    keep = dx * dx + dy * dy <= r * r + 1e-9
    return np.stack([dx[keep], dy[keep]], axis=1)


def _lines(cv: _Canvas, segs: np.ndarray, cols: np.ndarray, radius: float, mode: str, zref: np.ndarray | None = None,
           eps: float = 0.0) -> None:
    """Draw segments with a round pen of the radius (in canvas pixels).

    Modes: ``"depth"`` where nothing is nearer than ``zref`` (by more than ``eps``); ``"all"``
    everywhere; ``"visible"`` and ``"hidden"`` for the line style, where ``zref`` is the
    farthest depth around each pixel and the hidden parts are dashed.
    """
    if not len(segs):
        return
    W, H, k = cv.W, cv.H, cv.k
    ax, ay, az = cv.screen(segs[:, 0])
    bx, by, bz = cv.screen(segs[:, 1])
    length = np.hypot(bx - ax, by - ay)
    n = np.minimum(np.ceil(length / 0.7).astype(np.int64), 100_000) + 1
    seg = np.repeat(np.arange(len(n)), n)
    t = (np.arange(int(n.sum())) - np.repeat(np.cumsum(n) - n, n)) / np.repeat(np.maximum(n - 1, 1), n)
    # rounded first: an edge exactly on a pixel border must not wander into the next row
    px = np.round(ax[seg] + (bx[seg] - ax[seg]) * t, 6)
    py = np.round(ay[seg] + (by[seg] - ay[seg]) * t, 6)
    ix, iy = np.floor(px).astype(np.int64), np.floor(py).astype(np.int64)
    inside = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
    ix, iy, seg, t = ix[inside], iy[inside], seg[inside], t[inside]
    if mode != "all":
        pz = az[seg] + (bz[seg] - az[seg]) * t
        visible = pz >= zref[iy * W + ix] - eps  # type: ignore[index]
        if mode == "hidden":
            steep = np.abs(by - ay)[seg] > np.abs(bx - ax)[seg]
            # the dashes hang on the screen, so lines that coincide dash alike
            keep = ~visible & (np.where(steep, iy, ix) % (11 * k) < 7 * k)
        else:
            keep = visible
        ix, iy, seg = ix[keep], iy[keep], seg[keep]
    if not len(ix):
        return
    key = np.unique(seg.astype(np.int64) * (W * H) + iy * W + ix)  # one sample per pixel and segment
    seg, rest = key // (W * H), key % (W * H)
    ix, iy = rest % W, rest // W
    color = cols[seg]
    for dx, dy in _disc(radius):
        jx, jy = ix + dx, iy + dy
        ok = (jx >= 0) & (jx < W) & (jy >= 0) & (jy < H)
        cv.img[jy[ok] * W + jx[ok]] = color[ok]


def _center_lines(cv: _Canvas, scene: _Scene, cut: _Cut | None) -> None:
    """Center lines as in a technical drawing, thin and dash-dotted: a cross where a round
    feature is seen along its axis, a line along the axis where it is seen from the side;
    both a little past the outline. Oblique axes get none."""
    k, u = cv.k, cv.u
    over = 8 * u * k  # overhang past the outline, canvas pixels
    lines: list[tuple[float, float, float, float, float, float]] = []
    for foot, d, t0, t1, r in scene.axes():
        a, b = foot + d * t0, foot + d * t1
        if cut is not None:
            da, db = float(cut.distance(a)), float(cut.distance(b))
            if da > 0 and db > 0:
                continue  # cut away
            if da > 0 or db > 0:
                m = a + (b - a) * (da / (da - db))
                a, b = (m, b) if da > 0 else (a, m)
        along = float(d @ cv.cam.back)
        if abs(along) > 1 - 1e-6:  # seen along the axis: a cross, its arms cut like the part
            reach = r + over / cv.s
            ends = [a + v * reach for v in (cv.cam.right, -cv.cam.right, cv.cam.up, -cv.cam.up)]
            if cut is not None:
                ends = [_clip_segments(np.array([[a, e]]), cut) for e in ends]
                ends = [e[0, 1] for e in ends if len(e)]
            x, y, _ = cv.screen(np.stack([a, *ends]))
            lines += [(x[0], y[0], x[i], y[i], x[0], y[0]) for i in range(1, len(x))]
        elif abs(along) < 1e-6 and t1 > t0:  # seen from the side: the axis
            x, y, _ = cv.screen(np.stack([a, b]))
            length = math.hypot(x[1] - x[0], y[1] - y[0])
            if length < 1e-9:
                continue
            ux, uy = (x[1] - x[0]) / length, (y[1] - y[0]) / length
            lines.append((x[0] - ux * over, y[0] - uy * over, x[1] + ux * over, y[1] + uy * over,
                          (x[0] + x[1]) / 2, (y[0] + y[1]) / 2))
    if not lines:
        return
    s = np.array(lines)
    length = np.hypot(s[:, 2] - s[:, 0], s[:, 3] - s[:, 1])
    n = np.ceil(length / 0.5).astype(np.int64) + 1
    i = np.repeat(np.arange(len(n)), n)
    t = (np.arange(int(n.sum())) - np.repeat(np.cumsum(n) - n, n)) / np.repeat(np.maximum(n - 1, 1), n)
    px = s[i, 0] + (s[i, 2] - s[i, 0]) * t
    py = s[i, 1] + (s[i, 3] - s[i, 1]) * t
    # a long dash, a gap, a dot, a gap; a dash sits on the middle of every line
    dist = np.hypot(px - s[i, 4], py - s[i, 5]) / (u * k)
    phase = (dist + 6) % 20
    on = (phase < 12) | ((phase >= 15) & (phase < 17))
    x = np.floor(np.round(px[on], 6)).astype(np.int64)
    y = np.floor(np.round(py[on], 6)).astype(np.int64)
    for dx, dy in _disc(0.5 * k):
        jx, jy = x + dx, y + dy
        ok = (jx >= 0) & (jx < cv.W) & (jy >= 0) & (jy < cv.H)
        cv.img[jy[ok] * cv.W + jx[ok]] = _HIDDEN_INK


def _screen_lines(cv: _Canvas, segs: list[tuple[float, float, float, float]], color: np.ndarray, radius: float) -> None:
    """Segments in canvas pixels, drawn on top."""
    if not segs:
        return
    s = np.array(segs, dtype=np.float64)
    length = np.hypot(s[:, 2] - s[:, 0], s[:, 3] - s[:, 1])
    n = np.ceil(length / 0.5).astype(np.int64) + 1
    i = np.repeat(np.arange(len(n)), n)
    t = (np.arange(int(n.sum())) - np.repeat(np.cumsum(n) - n, n)) / np.repeat(np.maximum(n - 1, 1), n)
    x = np.floor(np.round(s[i, 0] + (s[i, 2] - s[i, 0]) * t, 6)).astype(np.int64)
    y = np.floor(np.round(s[i, 1] + (s[i, 3] - s[i, 1]) * t, 6)).astype(np.int64)
    for dx, dy in _disc(radius):
        jx, jy = x + dx, y + dy
        ok = (jx >= 0) & (jx < cv.W) & (jy >= 0) & (jy < cv.H)
        cv.img[jy[ok] * cv.W + jx[ok]] = color


def _dot(cv: _Canvas, p: np.ndarray, color: np.ndarray, radius_px: float) -> None:
    x, y, _ = cv.screen(p[None])
    _screen_lines(cv, [(x[0], y[0], x[0], y[0])], color, radius_px * cv.k)


def _marker(cv: _Canvas, pos: np.ndarray, label: str, color: np.ndarray) -> None:
    """A crosshair in a circle and the label to its right, with a white halo."""
    k, u = cv.k, cv.u
    x, y, _ = cv.screen(pos[None])
    cx, cy = float(x[0]), float(y[0])
    r, ring = (8 * u + 1) * k, (5.5 * u + 0.5) * k
    segs = [(cx - r, cy, cx + r, cy), (cx, cy - r, cx, cy + r)]
    a = np.linspace(0, 2 * np.pi, 41)
    segs += [(cx + ring * math.cos(a0), cy + ring * math.sin(a0), cx + ring * math.cos(a1), cy + ring * math.sin(a1))
             for a0, a1 in zip(a[:-1], a[1:])]
    _screen_lines(cv, segs, _WHITE, (0.5 * u + 1) * k)
    _screen_lines(cv, segs, color, 0.5 * u * k)
    if label:
        cv.text(cx / k + 8 * u + 5, cy / k - 3.5 * (u + 1), label, color, u + 1, halo=_WHITE)


def _annotate(cv: _Canvas, scene: _Scene) -> None:
    """The size of the bounding box (bottom right), the axes as the view shows them (bottom
    left) and a scale bar (bottom middle)."""
    k, w, h, u = cv.k, cv.w, cv.h, cv.u
    cv.text(w - 10 * u, h - 10 * u - 7 * (u + 1), " X ".join(_round_text(v) for v in scene.hi - scene.lo), _LABEL,
            u + 1, "end")
    ox, oy = 34 * u * k, (h - 34 * u) * k
    for d, color, name in ((np.array([1.0, 0, 0]), np.array([200, 40, 40]) / 255, "X"),
                           (np.array([0, 1.0, 0]), np.array([40, 150, 40]) / 255, "Y"),
                           (np.array([0, 0, 1.0]), np.array([40, 70, 200]) / 255, "Z")):
        dx, dy = float(d @ cv.cam.right), -float(d @ cv.cam.up)
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue  # the axis points into the screen
        ux, uy = dx / length, dy / length
        tx, ty = ox + ux * 26 * u * k, oy + uy * 26 * u * k
        _screen_lines(cv, [(ox, oy, tx, ty)], color, 0.6 * u * k)
        cv.text(tx / k + (ux * 6 - 2.5) * u, ty / k + (uy * 6 - 3.5) * u, name, color, u)
    scale = cv.s / k / u  # model units per overlay pixel
    bar = 10.0 ** math.floor(math.log10(100 / scale))
    for m in (1, 2, 5, 10):
        if bar * m * scale >= 60:
            bar *= m
            break
    half = bar * scale * u / 2
    x0, x1, y0 = (w / 2 - half) * k, (w / 2 + half) * k, (h - 16 * u) * k
    _screen_lines(cv, [(x0, y0, x1, y0), (x0, y0, x0, y0 - 4 * u * k), (x1, y0, x1, y0 - 4 * u * k)], _LABEL,
                  0.5 * u * k)
    cv.text(w / 2, h - 30 * u, _round_text(bar), _LABEL, u, "middle")


def _round_text(v: float) -> str:
    v = float(v)
    if abs(v - round(v)) < 0.05:
        return str(int(round(v)))
    return f"{v:.1f}" if abs(v) >= 1 else f"{v:.3g}"


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


# -----------------------------------------------------------------------------
# sheets and drawings
# -----------------------------------------------------------------------------
def _sheet_views(sheet: Any) -> list[Any]:
    if sheet is True:
        return ["top", "iso", "front", "right"]
    views = list(sheet)
    if len(views) not in (2, 4):
        raise ValueError(f"sheet takes True, 4 views or 2 views, got {len(views)} views")
    return views


def _sheet(scene: _Scene, views: list[Any], w: int, h: int, o: _Options, lines: list[bool] | None = None,
           labels: list[str] | None = None, band: int = -1) -> np.ndarray:
    """Views in one picture: 2 x 2 panels, or 2 side by side. Named ortho views share one scale
    (the smallest of their fits) and keep their own middles, so they line up like the views of
    a drawing; the others fit themselves (panel ``band`` above a strip at its bottom kept free
    for a caption)."""
    rows = 1 if len(views) == 2 else 2
    qw, qh = w // 2, h // rows
    cams = [None if v is None else _Camera.of(v) for v in views]
    fits = [None if c is None else _fit(scene, c, qw, qh) for c in cams]
    if band >= 0 and fits[band] is not None:
        strip = min(_CAPTION, qh // 3)
        fit = _fit(scene, cams[band], qw, qh - strip)  # type: ignore[arg-type]
        fits[band] = {**fit, "mid_y": fit["mid_y"] - strip / 2 / fit["scale"]}
    ortho = [i for i, v in enumerate(views) if isinstance(v, str) and v.lower() in _ORTHO]
    if ortho:
        common = min(fits[i]["scale"] for i in ortho)  # type: ignore[index]
        for i in ortho:
            fits[i] = {**fits[i], "scale": common}  # type: ignore[dict-item]
    img = np.empty((h, w, 3))
    img[:] = o.bg
    shaded = [i for i, c in enumerate(cams) if c is not None and not (o.lines if lines is None else lines[i])]
    for i, (cam, fr) in enumerate(zip(cams, fits)):
        if cam is None or fr is None:
            continue
        legend = bool(shaded) and i == shaded[-1]  # one legend for the sheet, in the last shaded panel
        tile = _view(scene, cam, qw, qh, o.panel(o.lines if lines is None else lines[i], legend), fr)
        y0, x0 = (i // 2) * qh, (i % 2) * qw
        img[y0:y0 + qh, x0:x0 + qw] = tile
        _text(img, x0 + 8, y0 + 8, labels[i] if labels else cam.label or chr(65 + i), _LABEL, 2)
    if rows == 2:
        img[qh:qh + 1, :] = _DIVIDER
    img[:, qw:qw + 1] = _DIVIDER
    return img


def _drawing(scene: _Scene, w: int, h: int, o: _Options, drawing: Any) -> np.ndarray:
    """Front, top and side view in line style, placed by the projection method, and a shaded
    iso view in the free corner, labelled with the method."""
    spec = {"projection": drawing} if isinstance(drawing, str) else dict(drawing) if isinstance(drawing, dict) else {}
    projection = spec.get("projection") or "first-angle"
    if projection not in ("first-angle", "third-angle"):
        raise ValueError(f"drawing: the projection is 'first-angle' or 'third-angle', got {projection!r}")
    third = projection == "third-angle"
    side = spec.get("side") or ("right" if third else "left")
    if side not in ("left", "right"):
        raise ValueError(f"drawing: the side is 'left' or 'right', got {side!r}")
    # first angle: the view from the left stands right of the front view, the top view below
    # it; third angle: the view from the right stands right of it, the top view above it
    side_right = (side == "right") if third else (side == "left")
    front_col = 0 if side_right else 1
    front_row = 1 if third else 0
    views: list[Any] = [None] * 4
    views[front_row * 2 + front_col] = "front"
    views[(1 - front_row) * 2 + front_col] = "top"
    views[front_row * 2 + 1 - front_col] = side
    free = (1 - front_row) * 2 + 1 - front_col
    if spec.get("iso", True):
        views[free] = "iso"
    names = {"front": "FRONT", "top": "TOP", "left": "FROM LEFT", "right": "FROM RIGHT", "iso": "ISO"}
    plain = replace(o, xray=False)
    img = _sheet(scene, views, w, h, plain, [v != "iso" for v in views], [names.get(v, "") for v in views], free)
    text = "THIRD-ANGLE PROJECTION - ISO A" if third else "FIRST-ANGLE PROJECTION - ISO E"
    qw, qh = w // 2, h // 2
    scale = 2 if _text_width(text, 2) <= qw - 20 else 1
    _text(img, (free % 2) * qw + qw - 10, (free // 2) * qh + qh - 12 - 7 * scale, text, _LABEL, scale, "end")
    return img


# -----------------------------------------------------------------------------
# text: a 5 x 7 bitmap font
# -----------------------------------------------------------------------------
_GLYPHS = {
    "A": (" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"),
    "B": ("#### ", "#   #", "#   #", "#### ", "#   #", "#   #", "#### "),
    "C": (" ### ", "#   #", "#    ", "#    ", "#    ", "#   #", " ### "),
    "D": ("#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "),
    "E": ("#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"),
    "F": ("#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#    "),
    "G": (" ### ", "#   #", "#    ", "# ###", "#   #", "#   #", " ####"),
    "H": ("#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"),
    "I": (" ### ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "),
    "J": ("  ###", "   # ", "   # ", "   # ", "   # ", "#  # ", " ##  "),
    "K": ("#   #", "#  # ", "# #  ", "##   ", "# #  ", "#  # ", "#   #"),
    "L": ("#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"),
    "M": ("#   #", "## ##", "# # #", "# # #", "#   #", "#   #", "#   #"),
    "N": ("#   #", "#   #", "##  #", "# # #", "#  ##", "#   #", "#   #"),
    "O": (" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "),
    "P": ("#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "),
    "Q": (" ### ", "#   #", "#   #", "#   #", "# # #", "#  # ", " ## #"),
    "R": ("#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"),
    "S": (" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "),
    "T": ("#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "),
    "U": ("#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "),
    "V": ("#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "),
    "W": ("#   #", "#   #", "#   #", "# # #", "# # #", "# # #", " # # "),
    "X": ("#   #", "#   #", " # # ", "  #  ", " # # ", "#   #", "#   #"),
    "Y": ("#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "),
    "Z": ("#####", "    #", "   # ", "  #  ", " #   ", "#    ", "#####"),
    "0": (" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "),
    "1": ("  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "),
    "2": (" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"),
    "3": ("#####", "   # ", "  #  ", "   # ", "    #", "#   #", " ### "),
    "4": ("   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "),
    "5": ("#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "),
    "6": ("  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "),
    "7": ("#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "),
    "8": (" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "),
    "9": (" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "),
    " ": ("     ",) * 7,
    ".": ("     ", "     ", "     ", "     ", "     ", " ##  ", " ##  "),
    ",": ("     ", "     ", "     ", "     ", " ##  ", "  #  ", " #   "),
    ":": ("     ", " ##  ", " ##  ", "     ", " ##  ", " ##  ", "     "),
    ";": ("     ", " ##  ", " ##  ", "     ", " ##  ", "  #  ", " #   "),
    "-": ("     ", "     ", "     ", "#####", "     ", "     ", "     "),
    "+": ("     ", "  #  ", "  #  ", "#####", "  #  ", "  #  ", "     "),
    "=": ("     ", "     ", "#####", "     ", "#####", "     ", "     "),
    "/": ("     ", "    #", "   # ", "  #  ", " #   ", "#    ", "     "),
    "\\": ("     ", "#    ", " #   ", "  #  ", "   # ", "    #", "     "),
    "(": ("   # ", "  #  ", " #   ", " #   ", " #   ", "  #  ", "   # "),
    ")": (" #   ", "  #  ", "   # ", "   # ", "   # ", "  #  ", " #   "),
    "[": (" ### ", " #   ", " #   ", " #   ", " #   ", " #   ", " ### "),
    "]": (" ### ", "   # ", "   # ", "   # ", "   # ", "   # ", " ### "),
    "<": ("   # ", "  #  ", " #   ", "#    ", " #   ", "  #  ", "   # "),
    ">": (" #   ", "  #  ", "   # ", "    #", "   # ", "  #  ", " #   "),
    "_": ("     ", "     ", "     ", "     ", "     ", "     ", "#####"),
    "'": ("  #  ", "  #  ", " #   ", "     ", "     ", "     ", "     "),
    '"': (" # # ", " # # ", "     ", "     ", "     ", "     ", "     "),
    "!": ("  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "     ", "  #  "),
    "?": (" ### ", "#   #", "    #", "   # ", "  #  ", "     ", "  #  "),
    "#": (" # # ", " # # ", "#####", " # # ", "#####", " # # ", " # # "),
    "%": ("##   ", "##  #", "   # ", "  #  ", " #   ", "#  ##", "   ##"),
    "*": ("     ", "  #  ", "# # #", " ### ", "# # #", "  #  ", "     "),
    "&": (" ##  ", "#  # ", "# #  ", " #   ", "# # #", "#  # ", " ## #"),
    "@": (" ### ", "#   #", "# ###", "# # #", "# ###", "#    ", " ####"),
    "|": ("  #  ",) * 7,
    "~": ("     ", "     ", " #   ", "# # #", "   # ", "     ", "     "),
    "°": (" ##  ", "#  # ", "#  # ", " ##  ", "     ", "     ", "     "),
    "²": (" ##  ", "   # ", "  #  ", " ### ", "     ", "     ", "     "),
    "Ø": (" ####", "#  ##", "# # #", "# # #", "# # #", "##  #", "#### "),
    "×": ("     ", "#   #", " # # ", "  #  ", " # # ", "#   #", "     "),
    "±": ("  #  ", "  #  ", "#####", "  #  ", "  #  ", "     ", "#####"),
}
_FONT = {ch: np.array([[c == "#" for c in row] for row in rows]) for ch, rows in _GLYPHS.items()}


def _text_width(text: str, scale: int = 1) -> int:
    return len(text) * 6 * scale - scale if text else 0


def _text(img: np.ndarray, x: float, y: float, text: str, color: np.ndarray, scale: int = 1,
          anchor: str = "start", halo: np.ndarray | None = None) -> None:
    """Text in the 5 x 7 font, in capitals. (x, y) is the top left of the text, or its top
    middle or top right for anchor "middle" or "end". Characters without a glyph stay blank.
    ``halo``: a one pixel outline in this color, so the text reads on any background."""
    text = str(text).upper()
    if not text:
        return
    mask = np.zeros((7 * scale + 2, len(text) * 6 * scale + 2), dtype=bool)
    for i, ch in enumerate(text):
        glyph = _FONT.get(ch)
        if glyph is not None:
            mask[1:-1, 1 + i * 6 * scale:1 + i * 6 * scale + 5 * scale] = np.kron(glyph, np.ones((scale, scale), bool))
    width = _text_width(text, scale)
    x0 = round(x - (width if anchor == "end" else width / 2 if anchor == "middle" else 0)) - 1
    y0 = round(y) - 1
    h, w = img.shape[:2]
    sx0, sy0 = max(x0, 0), max(y0, 0)
    sx1, sy1 = min(x0 + mask.shape[1], w), min(y0 + mask.shape[0], h)
    if sx1 <= sx0 or sy1 <= sy0:
        return
    region = img[sy0:sy1, sx0:sx1]
    if halo is not None:
        grown = mask.copy()
        grown[1:] |= mask[:-1]
        grown[:-1] |= mask[1:]
        grown[:, 1:] |= grown[:, :-1].copy()
        grown[:, :-1] |= grown[:, 1:].copy()
        region[grown[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0]] = halo
    region[mask[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0]] = color


# -----------------------------------------------------------------------------
# PNG
# -----------------------------------------------------------------------------
def _png(img: np.ndarray) -> bytes:
    h, w, _ = img.shape
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), img.reshape(h, w * 3)], axis=1).tobytes()

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def _png_decode(data: bytes) -> np.ndarray:
    """An 8-bit, non-interlaced PNG (gray, RGB, gray and alpha, RGBA) as an (h, w, 3) uint8 array."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG file")
    pos, idat = 8, []
    w = h = depth = ctype = interlace = 0
    while pos + 8 <= len(data):
        n, tag = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if tag == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat.append(body)
        elif tag == b"IEND":
            break
        pos += 12 + n
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}.get(ctype)
    if depth != 8 or bpp is None or interlace:
        raise ValueError("only 8-bit, non-interlaced gray, RGB and RGBA PNG files can be read")
    raw = np.frombuffer(zlib.decompress(b"".join(idat)), dtype=np.uint8).reshape(h, 1 + w * bpp)
    filters, rows = raw[:, 0], raw[:, 1:].astype(np.int32)
    out = np.zeros((h, w * bpp), dtype=np.int32)
    zero = np.zeros(w * bpp, dtype=np.int32)
    for r in range(h):
        line, prev, f = rows[r], (out[r - 1] if r else zero), filters[r]
        if f == 0:
            out[r] = line
        elif f == 1:
            out[r] = np.cumsum(line.reshape(w, bpp), axis=0).reshape(-1) % 256
        elif f == 2:
            out[r] = (line + prev) % 256
        else:  # average and Paeth depend on the pixel to the left: one value at a time
            cur = [0] * (w * bpp)
            for i in range(w * bpp):
                a = cur[i - bpp] if i >= bpp else 0
                b = int(prev[i])
                if f == 3:
                    pred = (a + b) // 2
                else:
                    c = int(prev[i - bpp]) if i >= bpp else 0
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pred = a if pa <= pb and pa <= pc else b if pb <= pc else c
                cur[i] = (int(line[i]) + pred) % 256
            out[r] = cur
    img = out.reshape(h, w, bpp).astype(np.uint8)
    if bpp < 3:
        img = np.repeat(img[..., :1], 3, axis=2)
    return img[..., :3]
