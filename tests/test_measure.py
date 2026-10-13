"""Measures at the default accuracy, held to what it promises.

``ACCURACY`` (1e-7) promises volumes and areas to 1e-7 of their value, centers to 1e-7 of the
body's size and the inertia to 1e-7 of its largest principal moment. The solids below have
closed forms; the spring, the flange and dense free-form bodies are checked against their own
integration at 1e-10.
"""

import importlib.util
import math
import time
import warnings
from pathlib import Path

import numpy as np
import pytest

from smlibpy import *
from smlibpy._kernel import ext
from smlibpy.shapes import ACCURACY

ROOT = Path(__file__).resolve().parent.parent
PI = math.pi


def _box_inertia(m, a, b, c):
    return np.diag([m * (b * b + c * c) / 12, m * (a * a + c * c) / 12, m * (a * a + b * b) / 12])


def _frustum(r1, r2, h):
    """Volume, centroid height and inertia (about the centroid) of a cone frustum on z = 0."""
    p = np.polynomial.polynomial
    r = [r1, (r2 - r1) / h]
    r2_, r4 = p.polymul(r, r), p.polymul(p.polymul(r, r), p.polymul(r, r))

    def integral(c):
        return p.polyval(h, p.polyint(c))

    v = PI * integral(r2_)
    zc = PI * integral(p.polymul(r2_, [0, 1])) / v
    izz = PI / 2 * integral(r4)
    ixx = PI / 4 * integral(r4) + PI * integral(p.polymul(r2_, [zc * zc, -2 * zc, 1]))
    return v, zc, np.diag([ixx, ixx, izz])


def _rounded_rectangle(a, b, r):
    """Area and the integrals of x^2 and y^2 of a centered a x b rectangle with corner radius r."""
    area = a * b - (4 - PI) * r * r
    # a corner's spandrel: the r x r square minus the quarter disc, about the corner's center
    x0, y0 = a / 2 - r, b / 2 - r

    def second(c):  # integral of x^2 over one spandrel at offset c (x0 or y0)
        square = r * ((c + r) ** 3 - c ** 3) / 3
        quarter = c * c * PI * r * r / 4 + 2 * c * r ** 3 / 3 + PI * r ** 4 / 16
        return square - quarter

    x2 = b * a ** 3 / 12 - 4 * second(x0)
    y2 = a * b ** 3 / 12 - 4 * second(y0)
    return area, x2, y2


def closed_forms():
    out = []
    a, b, c = 10.0, 20.0, 30.0
    out.append(("box", Box(a, b, c).translate(3, -4, 5), a * b * c, 2 * (a * b + b * c + a * c), (3, -4, 5),
                _box_inertia(a * b * c, a, b, c)))
    r = 10.0
    m = 4 / 3 * PI * r ** 3
    out.append(("sphere", Sphere(r).translate(1, 2, 3), m, 4 * PI * r * r, (1, 2, 3), np.eye(3) * 0.4 * m * r * r))
    r, h = 10.0, 20.0
    m = PI * r * r * h
    out.append(("cylinder", Cylinder(r, h), m, 2 * PI * r * (h + r), (0, 0, 0),
                np.diag([m * (3 * r * r + h * h) / 12] * 2 + [m * r * r / 2])))
    for r1, r2 in ((10.0, 4.0), (10.0, 0.0)):
        h = 15.0
        v, zc, inertia = _frustum(r1, r2, h)
        area = PI * (r1 + r2) * math.hypot(h, r1 - r2) + PI * (r1 * r1 + r2 * r2)
        out.append((f"cone {r1:g}/{r2:g}", Cone(r1, r2, h, align=(Align.CENTER, Align.CENTER, Align.MIN)), v, area,
                    (0, 0, zc), inertia))
    big, small = 20.0, 5.0
    m = 2 * PI * PI * big * small ** 2
    out.append(("torus", Torus(big, small), m, 4 * PI * PI * big * small, (0, 0, 0),
                np.diag([m * (big ** 2 / 2 + 5 * small ** 2 / 8)] * 2 + [m * (big ** 2 + 3 * small ** 2 / 4)])))
    # a box with its four vertical edges rounded: a prism of a rounded rectangle
    a, b, c, r = 30.0, 20.0, 10.0, 3.0
    box = Box(a, b, c)
    area2, x2, y2 = _rounded_rectangle(a, b, r)
    m = area2 * c
    out.append(("filleted box", box.fillet(box.edges().parallel_to(Z), r), m,
                2 * area2 + (2 * (a + b) - 8 * r + 2 * PI * r) * c, (0, 0, 0),
                np.diag([c * y2 + area2 * c ** 3 / 12, c * x2 + area2 * c ** 3 / 12, c * (x2 + y2)])))
    # all edges rounded: a smaller box grown by a ball (cylinders along the edges, spheres at the corners)
    a, b, c, r = 30.0, 20.0, 10.0, 2.0
    p, q, s = a - 2 * r, b - 2 * r, c - 2 * r
    v = p * q * s + 2 * (p * q + q * s + s * p) * r + PI * (p + q + s) * r * r + 4 / 3 * PI * r ** 3
    area = 2 * (p * q + q * s + s * p) + 2 * PI * (p + q + s) * r + 4 * PI * r * r
    out.append(("rounded box", Box(a, b, c).fillet(Box(a, b, c).edges(), r), v, area, (0, 0, 0), None))
    # a plate with a through hole
    a, b, c, r = 40.0, 30.0, 20.0, 6.0
    mh = PI * r * r * c
    out.append(("plate with a hole", Box(a, b, c) - Cylinder(r, 30), a * b * c - mh,
                2 * (a * b - PI * r * r) + 2 * (a + b) * c + 2 * PI * r * c, (0, 0, 0),
                _box_inertia(a * b * c, a, b, c) - np.diag([mh * (3 * r * r + c * c) / 12] * 2 + [mh * r * r / 2])))
    return out


@pytest.mark.parametrize("name,part,volume,area,center,inertia", closed_forms(), ids=lambda v: v if isinstance(v, str) else "")
def test_closed_forms_at_the_default_accuracy(name, part, volume, area, center, inertia):
    mp = part.mass_properties()
    size = part.bbox().diagonal
    assert abs(mp.volume - volume) <= ACCURACY * volume
    assert abs(part.volume - volume) <= ACCURACY * volume
    assert abs(mp.area - area) <= ACCURACY * area
    assert (mp.center - Vector(center)).length <= ACCURACY * size
    if inertia is not None:
        assert np.abs(mp.inertia - inertia).max() <= ACCURACY * np.abs(inertia).max()


def test_faces_and_sketches_at_the_default_accuracy():
    r, h = 10.0, 20.0
    side = Cylinder(r, h).faces().filter_by(lambda f: f.geom_type == "cylinder").one()
    assert abs(side.area - 2 * PI * r * h) <= ACCURACY * 2 * PI * r * h
    assert side.center().length <= ACCURACY * math.hypot(2 * r, 2 * r, h)
    ball = Sphere(7).faces().one()
    assert abs(ball.area - 4 * PI * 49) <= ACCURACY * 4 * PI * 49
    ring = Circle(10) - Circle(4)
    assert abs(ring.area - PI * 84) <= ACCURACY * PI * 84
    assert abs((Ellipse(10, 4) - Rectangle(4, 2)).area - (PI * 40 - 8)) <= ACCURACY * (PI * 40 - 8)


def _outline_area(face):
    """The area inside a planar face's edges by Green's theorem on the edge curves, with a
    Gauss-Legendre rule exact for polynomial outlines (the curves of a font)."""
    x, w = np.polynomial.legendre.leggauss(16)
    total = 0.0
    for wire in face.wires():
        for e in wire.edges():
            c = e._curve()
            t0, t1 = e._range()
            knots = sorted({k for k in ext.curve_data(c)["knots"] if t0 < k < t1})
            part = 0.0
            for a, b in zip([t0, *knots], [*knots, t1]):
                for xi, wi in zip(x, w):
                    p, d = ext.curve_eval(c, 0.5 * (a + b) + 0.5 * (b - a) * xi, 1)
                    part += 0.5 * (b - a) * wi * (p[0] * d[1] - p[1] * d[0])
            total += -part if e._rev else part
    return abs(0.5 * total)


@pytest.mark.parametrize("text", ["@&8", "Qq%", "(", "SMLIB 42"])
def test_lettering_area_matches_its_outlines(text):
    # the kernel's integration was off by up to 1.1e-5 here (Qq%) at the same accuracy
    sketch = Text(text, 10)
    exact = sum(_outline_area(f) for f in sketch.faces())
    assert abs(sketch.area - exact) <= ACCURACY * exact


def _example(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "examples" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.model()


@pytest.mark.parametrize("name,volume", [("spring", 2170.0811), ("flange", 157979.623)])
def test_examples_against_a_tight_integration(name, volume):
    # the kernel's integration was 2.9e-5 (spring) and 8e-7 (flange) off at the default
    part = _example(name)
    mp = part.mass_properties()
    ref = part.named("again").mass_properties(accuracy=1e-10)  # a copy: nothing cached
    size = part.bbox().diagonal
    assert abs(mp.volume - ref.volume) <= ACCURACY * ref.volume
    assert abs(mp.area - ref.area) <= ACCURACY * ref.area
    assert (mp.center - ref.center).length <= ACCURACY * size
    assert np.abs(mp.inertia - ref.inertia).max() <= ACCURACY * np.abs(ref.inertia).max()
    assert ref.volume == pytest.approx(volume, rel=1e-6)


def test_dense_free_form_body():
    """A surface through 105 x 105 points, thickened: its offset face has about 200 x 230 knot
    spans, where the integration spends its time (0.6 s and 7 million surface points; with 15
    points a span and the kernel's evaluation it took 4.9 s). The kernel takes 0.4 s at 1e-7 and
    is 2e-8 off there, 39 s at 1e-11 and 7e-10 off."""
    pts = [[(x, y, 3 * np.sin(x / 7) * np.cos(y / 9)) for x in np.linspace(0, 100, 105)]
           for y in np.linspace(0, 100, 105)]
    body = surface(pts).thicken(2)
    t = time.perf_counter()
    mp = body.mass_properties()
    elapsed = time.perf_counter() - t
    ref = body.named("again").mass_properties(accuracy=1e-10)
    size = body.bbox().diagonal
    assert abs(mp.volume - ref.volume) <= ACCURACY * ref.volume
    assert abs(mp.area - ref.area) <= ACCURACY * ref.area
    assert (mp.center - ref.center).length <= ACCURACY * size
    assert np.abs(mp.inertia - ref.inertia).max() <= ACCURACY * np.abs(ref.inertia).max()
    assert ref.volume == pytest.approx(20730.45218, rel=1e-6)  # the kernel at 1e-11
    assert body._h.props["evaluations"] < 10_000_000 and elapsed < 10.0


def test_folded_face():
    """Thickening this surface folds the offset face over itself in thin strips along one edge
    (the normal turns over and back): the area element |Su x Sv| has corners there, which the
    inner integrals take a few bisections to find. The result converges like any other."""
    n = 10
    pts = [[(x, y, 3 * math.sin(x / 7) * math.cos(y / 9)) for y in np.linspace(0, 100, n)]
           for x in np.linspace(0, 100, n)]
    slab = surface(pts).thicken(5)
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # no "the integration reached a relative accuracy of ..."
        mp = slab.mass_properties()
    assert slab._h.props["converged"]  # bisection used to stop at the folds, 1.8e-7 off the face's area
    ref = slab.named("again").mass_properties(accuracy=1e-10)
    assert abs(mp.volume - ref.volume) <= ACCURACY * ref.volume
    assert abs(mp.area - ref.area) <= ACCURACY * ref.area
    assert ref.area == pytest.approx(22733.6, rel=1e-3)  # the kernel's offset body differs a little by platform


def test_accuracy_means_what_it_says():
    spring = _example("spring")
    ref = spring.mass_properties(accuracy=1e-10)
    for accuracy in (1e-3, 1e-5):
        mp = spring.named("copy").mass_properties(accuracy=accuracy)
        assert abs(mp.volume - ref.volume) <= accuracy * ref.volume
        assert abs(mp.area - ref.area) <= accuracy * ref.area


def test_measures_are_kept_with_the_part():
    part = Sphere(10) - Box(10, 10, 10, align=Align.MIN)
    v = part.volume
    assert part.mass_properties().volume == v and part.area == part.mass_properties().area
    assert part.mass_properties(accuracy=1e-3).volume == v  # the result at 1e-7 serves 1e-3 as well


def test_empty_part_has_no_center():
    empty = Box(10, 10, 10) - Box(20, 20, 20)
    assert empty.volume == 0 and empty.area == 0
    with pytest.raises(ZeroDivisionError):
        empty.center()


# -- curve lengths ------------------------------------------------------------------
def test_outline_lines_have_their_length():
    # The outline of a cylinder seen from the side: two 60 mm lines (top and bottom) made as
    # quadratic B-splines that start and end with a doubled control point. The kernel's length
    # integration gave up on the first half and reported 30.
    edges = Cylinder(30, 10).outline(Plane.XZ)
    assert sorted(round(e.length, 9) for e in edges) == [10, 10, 60, 60]
    for e in edges:
        if e.length > 20:
            a, b = e.start, e.end
            for t in (0.1, 0.25, 0.5, 0.9):
                assert e.point_at(t).distance_to(a + (b - a) * t) < 1e-9
            assert e.tangent_at(0.25).dot((b - a).normalized()) == pytest.approx(1)


def test_lengths_of_curves():
    assert CenterArc((0, 0), 5, 0, 270).length == pytest.approx(7.5 * PI, rel=1e-12)
    # the perimeter of an ellipse: 4a times the complete elliptic integral of the second kind
    x, w = np.polynomial.legendre.leggauss(64)
    theta = PI / 4 * (x + 1)
    perimeter = 4 * 10 * PI / 4 * np.dot(w, np.sqrt(1 - (1 - 0.16) * np.sin(theta) ** 2))
    assert Ellipse(10, 4).edges().one().length == pytest.approx(perimeter, rel=1e-10)
    # a spline against its arc length summed with Simpson's rule on a fine grid of parameters
    spline = Spline((0, 0), (10, 5), (20, -3), (30, 8), (35, 0))
    c = spline._curve()
    t0, t1 = spline._range()
    ts = np.linspace(t0, t1, 20001)
    speed = np.array([np.linalg.norm(ext.curve_eval(c, t, 1)[1]) for t in ts])
    h = ts[1] - ts[0]
    s = np.concatenate([[0.0], np.cumsum(h / 3 * (speed[:-2:2] + 4 * speed[1:-1:2] + speed[2::2]))])
    assert spline.length == pytest.approx(s[-1], rel=1e-10)
    for f in (0.1, 0.37, 0.5, 0.83):  # point_at runs proportional to arc length
        t = np.interp(f * s[-1], s, ts[::2])
        assert spline.point_at(f).distance_to(Vector(ext.curve_eval(c, t, 0)[0])) < 1e-5
