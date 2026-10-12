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


# -- cameras ------------------------------------------------------------------------
def test_named_views_match_turntable_and_direction_cameras(bored):
    import math

    def px(view):
        return render(bored, view=view, size=(200, 150)).pixels

    iso_elevation = math.degrees(math.atan(1 / math.sqrt(2)))
    assert np.array_equal(px("front"), px({"azimuth": 0, "elevation": 0}))
    assert np.array_equal(px("front"), px({"direction": (0, 1, 0)}))
    assert np.array_equal(px("front"), px((0, -1, 0)))  # a tuple points towards the camera
    assert np.array_equal(px("right"), px({"azimuth": 90}))
    assert np.array_equal(px("left"), px({"azimuth": -90}))
    assert np.array_equal(px("top"), px({"elevation": 90}))
    assert np.array_equal(px("top"), px({"direction": (0, 0, -1)}))
    assert np.array_equal(px("bottom"), px({"direction": (0, 0, 1)}))
    assert np.array_equal(px("iso"), px({"azimuth": 45, "elevation": iso_elevation}))
    assert np.array_equal(px("iso"), px((1, -1, 1)))
    assert not np.array_equal(px({"azimuth": 60, "elevation": 20}), px({"azimuth": 50, "elevation": 20}))


def test_views_are_not_mirrored():
    body = Box(20, 20, 20)
    bump = Box(4, 4, 4).translate(0, -12, 0).colored("red")  # sticks out at the front (-Y)
    top = Box(4, 4, 4).translate(0, 0, 12).colored("red")  # and on top

    def red_x(view, *shapes):
        px = render(*shapes, view=view, size=(200, 200)).pixels.astype(int)
        red = (px[..., 0] > 150) & (px[..., 1] < 80)
        ys, xs = np.nonzero(red)
        return (xs.mean(), ys.mean()) if len(xs) else None

    assert red_x("right", body, bump)[0] < 90  # seen from +X, the front is on the left
    assert red_x("left", body, bump)[0] > 110  # seen from -X, on the right
    assert red_x("iso", body, top)[1] < 90  # Z is up


def test_zoom_look_at_and_frame(bored):
    a = render(bored, size=(300, 200))
    zoomed = render(bored, size=(300, 200), zoom=2)
    assert zoomed.frame["scale"] == pytest.approx(2 * a.frame["scale"])
    at = render(bored, view="front", size=(300, 200), look_at=(30, 0, 15))
    assert (at.frame["mid_x"], at.frame["mid_y"]) == pytest.approx((30, 15))
    # a pinned frame gives the same picture; zoom and look_at no longer apply
    again = render(bored, size=(300, 200), frame=a.frame, zoom=3, look_at=(1, 2, 3))
    assert bytes(again) == bytes(a)
    assert bytes(render(bored, size=(300, 200), frame=a)) == bytes(a)
    assert bytes(render(bored, size=(300, 200), frame={"scale": a.frame["scale"], "midX": a.frame["mid_x"],
                                                        "midY": a.frame["mid_y"]})) == bytes(a)
    # the frame does not change when the model does (that is the point of it)
    bigger = render(bored + Box(10, 10, 10).translate(40, 0, 0), size=(300, 200), frame=a.frame)
    assert bigger.frame == a.frame


def test_supersample_and_bad_options(bored):
    one = render(bored, size=(120, 90), supersample=1)
    two = render(bored, size=(120, 90))
    assert one.pixels.shape == two.pixels.shape == (90, 120, 3)
    assert not np.array_equal(one.pixels, two.pixels)
    for bad in ({"supersample": 5}, {"colors": "rainbow"}, {"view": "diagonal"}, {"zoom": 0}, {"xray_alpha": 1.5},
                {"sheet": ["top", "front", "iso"]}, {"drawing": "fourth-angle"}, {"size": (0, 10)}):
        with pytest.raises(ValueError):
            render(bored, **bad)


# -- colors -----------------------------------------------------------------------
def test_distinct_colors_tell_bodies_apart():
    twins = Box(10, 10, 10).colored("#888888") + Box(10, 10, 10).translate(20, 0, 0)  # one part, two solids
    native = render(twins, view="front", size=(200, 100), edges=False).pixels.astype(int)
    distinct = render(twins, view="front", size=(200, 100), edges=False, colors="distinct").pixels.astype(int)
    row = 50
    left, right = native[row, 50], native[row, 150]
    assert np.abs(left - right).max() <= 2 and np.ptp(left) <= 2  # the part's gray, on both solids
    left, right = distinct[row, 50], distinct[row, 150]
    assert np.abs(left - right).max() > 30  # one palette color per solid


# -- sheets -------------------------------------------------------------------------
def test_sheet_of_four_and_of_two_views():
    part = Box(80, 30, 20)
    pic = render(part, sheet=True, size=(800, 600))
    q = _quadrants(pic)
    for name in q:
        assert (q[name][30:].min(axis=-1) < 200).sum() > 500  # a body in every panel
    body = {k: np.argwhere(v[30:].min(axis=-1) < 200) for k, v in q.items()}
    # top (top left) and front (bottom left) share one scale: the same width
    assert np.ptp(body["TL"][:, 1]) == pytest.approx(np.ptp(body["BL"][:, 1]), abs=2)
    two = render(part, sheet=[{"azimuth": 30, "elevation": 30}, {"azimuth": -30, "elevation": 30}], size=(600, 300))
    halves = two.pixels[30:, 2:298], two.pixels[30:, 302:598]
    assert all((h.min(axis=-1) < 200).sum() > 500 for h in halves)
    assert not np.array_equal(*halves)
    assert bytes(render(part, sheet=True, size=(800, 600))) == bytes(pic)
    lined = render(part, sheet=True, lines=True, size=(800, 600))
    assert _gray(lined.pixels).all()


# -- sections -----------------------------------------------------------------------
_PALETTE0 = np.array([0x7C, 0x93, 0xB5]) / 255
_PALETTE1 = np.array([0xD9, 0x92, 0x5A]) / 255


def _exact(px, rgb):
    return np.all(px == np.round(np.asarray(rgb) * 255).astype(np.uint8), axis=-1)


def test_section_caps_are_hatched_and_alternate_between_bodies():
    a = Box(20, 20, 20).translate(-12, 0, 0)
    b = Box(20, 20, 20).translate(12, 0, 0)
    pic = render(a, b, view="front", section=Plane.XZ, size=(400, 200), supersample=1)
    ys, xs = np.nonzero(_exact(pic.pixels, 0.27 * _PALETTE0))  # the hatch of the first body
    assert len(xs) > 100 and np.all((xs + ys) % 7 == 0)
    ys, xs = np.nonzero(_exact(pic.pixels, 0.27 * _PALETTE1))  # the second body hatches the other way
    assert len(xs) > 100 and np.all((xs - ys) % 7 == 0)
    assert _exact(pic.pixels, 0.55 * 0.9 * _PALETTE0 + 0.45).sum() > 1000  # the light fill between


def test_section_keeps_bores_open_and_the_framing():
    part = Box(40, 20, 30) - Cylinder(6, 40)
    whole = render(part, view="front", size=(400, 300), supersample=1)
    cut = render(part, view="front", size=(400, 300), supersample=1, section=Plane.XZ)
    assert cut.frame == whole.frame  # the framing of the whole model
    right, up = (1, 0, 0), (0, 0, 1)
    fill = 0.55 * 0.9 * _PALETTE0 + 0.45
    ink = 0.27 * _PALETTE0
    x, y = _pixel(cut, right, up, (13, 0, 0))
    material = cut.pixels[y - 3:y + 4, x - 3:x + 4]
    assert (_exact(material, fill) | _exact(material, ink)).all()  # the cap
    x, y = _pixel(cut, right, up, (0, 0, 0))
    bore = cut.pixels[y - 3:y + 4, x - 3:x + 4]
    assert not (_exact(bore, fill) | _exact(bore, ink)).any()  # the bore stays open: its far wall shows
    assert (bore != 255).any(axis=-1).all()
    # without a cap, the inside of the back wall shows, darker than the front wall
    open_cut = render(part, view="front", size=(400, 300), supersample=1, section=Plane.XZ, cap=False)
    x, y = _pixel(open_cut, right, up, (13, 0, 0))
    inside = open_cut.pixels[y, x].astype(float)
    front = whole.pixels[y, x].astype(float)
    assert inside == pytest.approx(0.72 * front, abs=2)
    assert not _exact(open_cut.pixels, ink).any()
    # in line style the cap is hatched in gray on white
    lined = render(part, view="front", size=(400, 300), supersample=1, section=Plane.XZ, lines=True)
    ys, xs = np.nonzero(_exact(lined.pixels, np.array([70, 70, 70]) / 255))
    assert len(xs) > 100 and np.all((xs + ys) % 7 == 0)


def test_section_takes_a_face_a_tuple_and_a_dict(bored):
    by_plane = render(bored, section=Plane.XZ, size=(200, 150))
    assert bytes(render(bored, section=((0, 0, 0), (0, -1, 0)), size=(200, 150))) == bytes(by_plane)
    assert bytes(render(bored, section={"origin": (0, 0, 0), "normal": (0, -1, 0)}, size=(200, 150))) == bytes(by_plane)
    face = bored.faces().front()[0]  # the face at y = -20, normal -Y: cuts nothing away
    assert bytes(render(bored, section=face, size=(200, 150))) != bytes(by_plane)
    assert bytes(render(bored, section={"origin": (0, 0, 0), "normal": (0, -1, 0), "cap": False},
                        size=(200, 150))) == bytes(render(bored, section=Plane.XZ, cap=False, size=(200, 150)))


# -- highlights and markers ------------------------------------------------------------
def _orange(px):
    px = px.astype(int)
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    return (r > 120) & (g > 0.3 * r) & (g < 0.62 * r) & (b < 0.2 * r)


def _red(px):
    px = px.astype(int)
    return (px[..., 0] > 150) & (px[..., 1] < 90) & (px[..., 2] < 90)


def test_highlight_faces_edges_and_points():
    plate = Box(40, 30, 10)
    plain = render(plate, size=(300, 200))
    assert not _orange(plain.pixels).any() and not _red(plain.pixels).any()
    top = render(plate, size=(300, 200), highlight=plate.faces().top())
    assert _orange(top.pixels).sum() > 3000
    hidden = render(plate, size=(300, 200), highlight=plate.faces().bottom())
    assert not _orange(hidden.pixels).any()  # the bottom face is not in sight
    # the closest face to a point
    assert bytes(render(plate, size=(300, 200), highlight_at=[(1, 2, 5.5)])) == bytes(top)
    assert bytes(render(plate, size=(300, 200), highlight_at=(1, 2, 5.5))) == bytes(top)
    edges = render(plate, size=(300, 200), highlight=plate.faces().top().edges())
    assert _red(edges.pixels).sum() > 200 and not _orange(edges.pixels).any()
    corner = render(plate, size=(300, 200), highlight=plate.vertices().sort_by(Z)[-1])
    assert _red(corner.pixels).sum() > 10
    whole = render(plate, size=(300, 200), highlight=plate)
    assert _orange(whole.pixels).sum() > _orange(top.pixels).sum()
    in_drawing = render(plate, size=(400, 300), lines=True, highlight=plate.faces().top())
    assert _orange(in_drawing.pixels).sum() > 1000  # line style fills highlighted faces


def test_markers(bored):
    plain = render(bored, size=(300, 200))
    one = render(bored, size=(300, 200), markers=[(0, 0, 15)])
    labelled = render(bored, size=(300, 200), markers=[((0, 0, 15), "bore")])
    assert not _red(plain.pixels).any()
    assert _red(one.pixels).sum() > 25
    assert _red(labelled.pixels).sum() > _red(one.pixels).sum() + 20
    assert bytes(render(bored, size=(300, 200), markers=[{"position": (0, 0, 15), "label": "bore"}])) == bytes(labelled)
    green = render(bored, size=(300, 200), markers=[{"position": (0, 0, 15), "color": "green"}]).pixels.astype(int)
    assert not _red(green).any() and ((green[..., 1] > 100) & (green[..., 0] < 60)).sum() > 25


# -- annotate -------------------------------------------------------------------------
def test_annotate_writes_the_extents_and_orients_the_axes():
    from smlibpy.render import _LABEL, _text

    part = Box(60, 54, 34)
    pic = render(part, size=(800, 600), annotate=True)
    gray = _exact(pic.pixels, _LABEL)
    region = gray[500:, 520:]  # bottom right, clear of the scale bar
    ys, xs = np.nonzero(region)
    found = region[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    expected = np.zeros((40, 300, 3))
    _text(expected, 0, 0, "60 X 54 X 34", np.ones(3), 2)
    mask = expected[..., 0] > 0
    ys, xs = np.nonzero(mask)
    assert np.array_equal(found, mask[:ys.max() + 1, :xs.max() + 1])
    # the axes: all three in the iso view; Y points into the screen in the front view
    corner = pic.pixels[450:, :150].astype(int)
    for rgb in ((200, 40, 40), (40, 150, 40), (40, 70, 200)):
        assert (np.abs(corner - rgb).max(axis=-1) < 30).sum() > 10
    front = render(part, view="front", size=(800, 600), annotate=True).pixels[450:, :150].astype(int)
    assert (np.abs(front - (40, 150, 40)).max(axis=-1) < 30).sum() == 0
    assert (np.abs(front - (200, 40, 40)).max(axis=-1) < 30).sum() > 10


# -- x-ray ---------------------------------------------------------------------------
def test_xray_shows_what_is_hidden():
    front = Box(30, 10, 30).translate(0, -10, 0).colored("red")
    behind = Box(10, 10, 10).translate(0, 10, 0).colored("blue")
    opaque = render(front, behind, view="front", size=(200, 200)).pixels.astype(int)
    xray = render(front, behind, view="front", size=(200, 200), xray=True).pixels.astype(int)
    assert opaque[100, 100, 2] < 30  # the blue box is hidden
    assert xray[100, 100, 2] > opaque[100, 100, 2] + 40  # and shines through in x-ray
    assert xray[100, 100, 0] > 100  # the red one is still there
    # the edges of the hidden box are drawn, opaque
    row = xray[100]
    dark = np.nonzero(row.max(axis=-1) < 90)[0]
    assert ((dark > 70) & (dark < 130)).any()
    assert bytes(render(front, behind, view="front", size=(200, 200), xray=True)) == \
        bytes(render(front, behind, view="front", size=(200, 200), xray=True))


# -- sketches over solids ---------------------------------------------------------------
def test_sketch_over_a_part_is_drawn_on_its_plane():
    plate = Box(40, 30, 10)
    sketch = Circle(8).on(plate.faces().top())

    def blue(px):
        px = px.astype(int)
        return (px[..., 2] > 170) & (px[..., 0] < 70) & (px[..., 1] > 50) & (px[..., 1] < 140)

    assert not blue(render(plate, size=(300, 200)).pixels).any()
    over = render(plate, sketch, size=(300, 200))
    assert blue(over.pixels).sum() > 60
    # top view: the circle is a circle of radius 8 around the middle
    top = render(plate, sketch, view="top", size=(300, 200))
    ys, xs = np.nonzero(blue(top.pixels))
    r = np.hypot(xs - 150, ys - 100) / top.frame["scale"]
    assert np.median(r) == pytest.approx(8, abs=0.5)


# -- comparing pictures -----------------------------------------------------------------
def test_diff_images_with_a_pinned_frame(tmp_path):
    before_part = Box(40, 30, 10)
    after_part = before_part - Cylinder(3, 20).translate(12, 0, 0)
    before = render(before_part, size=(300, 200))
    after = render(after_part, size=(300, 200), frame=before.frame)
    same = diff_images(before, render(before_part, size=(300, 200)))
    assert same.changed == 0 and same.bbox is None and same.fraction == 0
    d = diff_images(before, after)
    assert d.changed > 50 and d.fraction < 0.05
    hx, hy = _pixel(before, (0.7071067811865476, 0.7071067811865476, 0),
                    (-0.4082482904638631, 0.4082482904638631, 0.8164965809277261), (12, 0, 5))
    x0, y0, x1, y1 = d.bbox
    assert x0 <= hx <= x1 and y0 <= hy <= y1 and x1 - x0 < 60
    assert _red(d.picture.pixels).sum() == d.changed
    # any form: pictures, PNG bytes, files, arrays
    before.save(tmp_path / "before.png")
    assert diff_images(tmp_path / "before.png", bytes(after)).changed == d.changed
    assert diff_images(str(tmp_path / "before.png"), after.pixels).changed == d.changed
    assert diff_images(before, after, tolerance=255).changed == 0
    with pytest.raises(ValueError, match="size"):
        diff_images(before, render(before_part, size=(200, 200)))


def test_png_reader_handles_every_filter():
    import struct
    import zlib

    from smlibpy.render import _png_decode

    rng = np.random.default_rng(1)
    img = rng.integers(0, 256, size=(5, 4, 3), dtype=np.uint8)
    raw = bytearray()
    prev = np.zeros(12, dtype=np.int32)
    for r in range(5):
        line = img[r].reshape(-1).astype(np.int32)
        f = r % 5
        out = []
        for i in range(12):
            a = int(line[i - 3]) if i >= 3 else 0
            b = int(prev[i])
            c = int(prev[i - 3]) if i >= 3 else 0
            p = a + b - c
            paeth = a if abs(p - a) <= abs(p - b) and abs(p - a) <= abs(p - c) else b if abs(p - b) <= abs(p - c) else c
            pred = (0, a, b, (a + b) // 2, paeth)[f]
            out.append((int(line[i]) - pred) % 256)
        raw += bytes([f] + out)
        prev = line

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 5, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw))) + chunk(b"IEND", b""))
    assert np.array_equal(_png_decode(png), img)


# -- text -----------------------------------------------------------------------------
def test_font_covers_the_labels():
    from smlibpy.render import _FONT, _text

    for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;-+=/()[]<>_'\"!?#%*&@|°Ø×±":
        assert ch in _FONT and _FONT[ch].shape == (7, 5)
    a, b = np.zeros((10, 80, 3)), np.zeros((10, 80, 3))
    _text(a, 0, 0, "Iso view", np.ones(3))
    _text(b, 0, 0, "ISO VIEW", np.ones(3))
    assert np.array_equal(a, b) and a.sum() > 0


def test_everything_together_is_deterministic(bored):
    def go():
        return render(bored, drawing="third-angle", section=Plane.XZ, xray=True, annotate=True,
                      highlight=bored.faces().top(), markers=[((0, 0, 15), "top")], size=(500, 400))

    assert bytes(go()) == bytes(go())
