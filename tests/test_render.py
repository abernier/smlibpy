"""The software renderer: views, line style, drawings and the other options, checked on the
pixels they produce."""

import numpy as np
import pytest

from smlibpy import *
from smlibpy.render import Picture


@pytest.fixture(scope="module")
def bored():
    """A box with a vertical bore: from the front the bore is hidden."""
    return Box(60, 40, 30) - Cylinder(8, 40)


def _pixel(pic, view_right, view_up, point):
    """Where a world point lands in a single-view picture (right and up: the view's screen axes)."""
    f = pic.frame
    x = pic.width / 2 + (np.dot(point, view_right) - f["mid_x"]) * f["scale"]
    y = pic.height / 2 - (np.dot(point, view_up) - f["mid_y"]) * f["scale"]
    return int(x), int(y)


def _gray(px):
    return np.abs(px.astype(int) - px.astype(int).mean(axis=-1, keepdims=True)).max(axis=-1) <= 2


def _runs(column):
    """Number of runs of drawn (not white) pixels along a column."""
    ink = column.min(axis=-1) < 235
    return int(np.count_nonzero(ink[1:] & ~ink[:-1]) + ink[0])


def test_lines_dash_hidden_edges(bored):
    pic = render(bored, view="front", lines=True, size=(400, 300))
    assert isinstance(pic, Picture) and isinstance(pic, bytes) and pic[:4] == b"\x89PNG"
    px = pic.pixels
    assert _gray(px).all()  # line style: no shading colors
    right, up = (1, 0, 0), (0, 0, 1)
    x_bore, _ = _pixel(pic, right, up, (8, 0, 0))
    x_mid, _ = _pixel(pic, right, up, (20, 0, 0))
    _, y_top = _pixel(pic, right, up, (0, 0, 15))
    _, y_bottom = _pixel(pic, right, up, (0, 0, -15))
    inner = slice(y_top + 4, y_bottom - 3)
    # the outline of the bore is hidden: dashed and lighter than the visible lines
    dashes = px[inner, x_bore - 1:x_bore + 2].min(axis=1)
    assert _runs(dashes) >= 4
    assert dashes.min() > 60
    assert (px[inner, x_mid] == 255).all()  # no line where the material is solid
    # the visible outline is solid and dark
    outline = px[y_top - 1:y_top + 2, x_bore + 5:x_mid + 20].min(axis=0)
    assert outline.max() < 60


def test_lines_draw_silhouettes_of_curved_faces():
    pic = render(Cylinder(10, 30), view="front", lines=True, size=(300, 300))
    right, up = (1, 0, 0), (0, 0, 1)
    x_left, y_mid = _pixel(pic, right, up, (-10, 0, 0))
    x_right, _ = _pixel(pic, right, up, (10, 0, 0))
    row = pic.pixels[y_mid].min(axis=1)
    assert row[x_left - 2:x_left + 3].min() < 60 and row[x_right - 2:x_right + 3].min() < 60
    assert (row[x_left + 5:x_right - 5] == 255).all()  # no seam line in between


def _quadrants(pic):
    h, w = pic.height // 2, pic.width // 2
    q = {}
    for name, (row, col) in {"TL": (0, 0), "TR": (0, 1), "BL": (1, 0), "BR": (1, 1)}.items():
        q[name] = pic.pixels[row * h + 2:row * h + h - 2, col * w + 2:col * w + w - 2]
    return q


def test_drawing_places_views_by_projection_method():
    # an L-shaped part: the views from the left and from the right differ
    part = Box(60, 40, 10, align=Align.MIN) + Box(10, 40, 40, align=Align.MIN)
    part -= Cylinder(5, 100).rotate(Y, 90).translate(0, 20, 25)
    size = (800, 600)
    first = _quadrants(render(part, drawing=True, size=size))
    third = _quadrants(render(part, drawing="third-angle", size=size))
    third_left = _quadrants(render(part, drawing={"projection": "third-angle", "side": "left"}, size=size))
    first_right = _quadrants(render(part, drawing={"projection": "first-angle", "side": "right"}, size=size))
    # first angle: front top left, the view from the left right of it, the top view below it
    # third angle: front bottom left, the top view above it, the view from the right right of it
    assert np.array_equal(first["TL"], third["BL"])  # front
    assert np.array_equal(first["BL"], third["TL"])  # top
    assert np.array_equal(first["TR"], third_left["BL"])  # from the left: right of the front view in first angle
    assert np.array_equal(third["BR"], first_right["TL"])  # from the right: right of it in third angle
    assert not np.array_equal(first["TR"], third["BR"])  # the two side views differ
    # the ortho views are drawn in line style, the iso view is shaded
    for q in ("TL", "TR", "BL"):
        assert _gray(first[q]).all()
    assert not _gray(first["BR"]).all() and not _gray(third["TR"]).all()


def test_drawing_ortho_views_share_one_scale_and_line_up():
    part = Box(80, 30, 20)
    pic = render(part, drawing=True, size=(800, 600))
    q = _quadrants(pic)
    ink = {k: np.argwhere(v[26:].min(axis=-1) < 100) + (26, 0) for k, v in q.items()}  # below the labels
    front, left, top = ink["TL"], ink["TR"], ink["BL"]
    # front and top: same width and columns; front and the side view: same rows
    assert abs(front[:, 1].min() - top[:, 1].min()) <= 1 and abs(front[:, 1].max() - top[:, 1].max()) <= 1
    assert abs(front[:, 0].max() - left[:, 0].max()) <= 1
    # 80 wide, 30 deep: the top view is 30/80 as high as the front view is wide (one scale)
    width = front[:, 1].max() - front[:, 1].min()
    depth = top[:, 0].max() - top[:, 0].min()
    assert depth / width == pytest.approx(30 / 80, rel=0.05)


def test_view_sheet_is_the_first_angle_drawing(bored):
    a = render(bored, view="sheet", size=(400, 300))
    b = render(bored, drawing="first-angle", size=(400, 300))
    assert bytes(a) == bytes(b) and a.frame is None


def test_same_input_same_pixels(bored):
    assert bytes(render(bored, drawing=True, size=(400, 300))) == bytes(render(bored, drawing=True, size=(400, 300)))
