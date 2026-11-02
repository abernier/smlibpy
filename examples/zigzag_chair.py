"""Zig-zag chair after Rietveld's 1934 Zig-Zag chair, in the proportions of the current production drawing: four
cherry boards 19 mm thick, the seat, the slant and the base tapered and mitred at 45 degrees, each mitre with a
glued cleat in its acute angle; the back dovetailed through the seat, a hand grip carved in its rear face."""

import math

from smlibpy import *

# Measured: the production drawing (model 280) gives 37 cm wide, 48 deep, 74 high, the seat at 43; the originals have
# boards of 18-19 mm. Read off its side view (3.39 mm a pixel, the 74 cm as the scale): the slant at 45 degrees to
# the seat and to the base, the back leaning back 8 degrees (98 to the seat), the base 418 long. Assumed: the rest,
# as the comments say. The chair faces -Y; x = 0 is its middle; the seat's nose (its top front corner) is at
# y = -240, so that the 480 of depth is -240..240.
T = 19.0  # every board's thickness
W_NOSE, W_FOOT = 370.0, 330.0  # the width at the nose (the drawing's 37 cm) and at the slant's rear bottom corner
SEAT_TOP, HEIGHT, DEPTH = 430.0, 740.0, 480.0  # the seat's top; the back's rear top corner: its height, behind the nose
Y_NOSE = -DEPTH / 2
SLANT, BACK_LEAN = 45.0, 8.0  # the slant to the floor; the back's lean from the vertical
BASE_LENGTH = 418.0  # the base's underside, from the slant's rear bottom corner to its square front end (drawing)
CLEAT = 30.0  # a cleat's legs, assumed: the drawing shows one in each mitre's acute angle, the photos one at the foot
# The seat carries six tails (counted on a photograph of the back's rear face; that the seat is the tail board is
# inferred: the tails' end grain shows on the back's rear face). At the back's rear face, where the tails are widest:
TAILS, SLOPE, PIN, HALF_PIN = 6, 1 / 6, 20.0, 20.0  # count, 1 in 6 as for hardwood, a pin, the back's edge half pins
# The hand grip in the back's rear face, assumed from a photograph: long (round ends included), high, deep, and how
# far its top is below the back's top edge, along the face. (A published build of the chair cuts it 130 x 20 x 10.)
GRIP, GRIP_HIGH, GRIP_DEEP, GRIP_BELOW = 140.0, 20.0, 10.0, 20.0
CHERRY = 0.6e-3  # g/mm3
BIG = 3000.0

S2 = math.sqrt(2)
MITRE = math.tan(math.radians(SLANT / 2))  # both mitres bisect the 45 degree angles: 22.5 degrees to the floor
LEAN = math.radians(BACK_LEAN)
UP = (0.0, math.sin(LEAN), math.cos(LEAN))  # along the back, upward
ACROSS = (0.0, math.cos(LEAN), -math.sin(LEAN))  # through the back, from its front face to its rear face

# The side view, (y, z). The slant's front face runs from the nose down backward at 45 degrees:
# (y - Y_NOSE) + (z - SEAT_TOP) = 0, and its rear face is T * sqrt(2) behind it along y.
NOSE = (Y_NOSE, SEAT_TOP)
SEAT_INNER = (Y_NOSE + T / MITRE, SEAT_TOP - T)  # the top mitre's inner corner: the seat's underside on the rear face
# The bottom mitre's outer corner, the base's underside on the slant's rear face: 456.9 behind the nose, the
# drawing's 455 within its pixel (the nose and this corner are on opposite faces of the slant).
FOOT = (Y_NOSE + SEAT_TOP + T * S2, 0.0)
BASE_INNER = (Y_NOSE + SEAT_TOP - T, T)  # its inner corner: the base's top on the slant's front face
BASE_FRONT = FOOT[0] - BASE_LENGTH
REAR_TOP = (Y_NOSE + DEPTH, HEIGHT)  # the back's rear face at its top
FRONT_TOP = (REAR_TOP[0] - T * ACROSS[1], REAR_TOP[1] - T * ACROSS[2])  # its top edge is square to its faces
SEAT_BOTTOM = SEAT_TOP - T  # the back ends flush with the seat's underside


def rear(z: float) -> float:
    """y of the back's rear face at height z; the seat's rear end lies on it."""
    return REAR_TOP[0] - (HEIGHT - z) * math.tan(LEAN)


def front(z: float) -> float:
    """y of the back's front face at height z."""
    return rear(z) - T / math.cos(LEAN)


SEAT = [NOSE, (front(SEAT_TOP), SEAT_TOP), (front(SEAT_BOTTOM), SEAT_BOTTOM), SEAT_INNER]  # to the back's front face
SLANT_BOARD = [NOSE, SEAT_INNER, FOOT, BASE_INNER]
BASE = [FOOT, BASE_INNER, (BASE_FRONT, T), (BASE_FRONT, 0.0)]
BACK = [(rear(SEAT_BOTTOM), SEAT_BOTTOM), REAR_TOP, FRONT_TOP, (front(SEAT_BOTTOM), SEAT_BOTTOM)]
# The cleats: right isosceles, one leg on the horizontal board, a vertical face, the hypotenuse on the slant.
TOP_CLEAT = [SEAT_INNER, (SEAT_INNER[0] + CLEAT, SEAT_BOTTOM), (SEAT_INNER[0] + CLEAT, SEAT_BOTTOM - CLEAT)]
FOOT_CLEAT = [BASE_INNER, (BASE_INNER[0] - CLEAT, T), (BASE_INNER[0] - CLEAT, T + CLEAT)]


# The widths. Two boards that share a mitre and have planar sides square to their own faces meet flush only if they
# narrow at the same rate along their faces, away from the mitre; so one rate for the seat, the slant and the base.
# Measured along each board from the nose (the seat backward, the slant downward), both narrow; at the foot the
# slant widens upward, away from the bottom mitre, so the base widens forward, away from it, at the same rate.
def along_slant(y: float, z: float) -> float:
    """Distance from the nose along the slant, downward."""
    return ((y - Y_NOSE) - (z - SEAT_TOP)) / S2


RATE = (W_NOSE - W_FOOT) / 2 / along_slant(*FOOT)  # how much each side comes in, a millimeter along a board


def seat_half(y: float, z: float = 0.0) -> float:
    return W_NOSE / 2 - RATE * (y - Y_NOSE)


def slant_half(y: float, z: float) -> float:
    return W_NOSE / 2 - RATE * along_slant(y, z)


def base_half(y: float, z: float = 0.0) -> float:
    return W_FOOT / 2 + RATE * (FOOT[0] - y)


# The back is not tapered: as wide as the seat at its front face, at the seat's mid-thickness. Its edges are the
# joint's half pins, so there the seat's taper and the back's square edge differ by a step of at most BACK_STEP.
W_BACK = 2 * seat_half(front(SEAT_TOP - T / 2))
BACK_STEP = max(abs(seat_half(front(z)) - W_BACK / 2) for z in (SEAT_TOP, SEAT_BOTTOM))
# The tails at the back's rear face (widest) and at its front face, where the pins are 2 T / 6 wider.
TAIL_REAR = (W_BACK - 2 * HALF_PIN - (TAILS - 1) * PIN) / TAILS
TAIL_FRONT = TAIL_REAR - 2 * T * SLOPE


def side_prism(profile: list[tuple[float, float]], width: float = BIG) -> Part:
    """A board seen from the side: its profile in (y, z), extruded across the chair, centered on x = 0."""
    board = Polygon(*profile).on(Plane.YZ).extrude(width)
    return board.translate(-width / 2 - board.bbox().min.x, 0, 0)


def sides(plane: Plane, half) -> Part:
    """The body between a board's two side planes: a trapezoid in `plane` (x across the chair, y along the board,
    the board's normal the plane's), half-width half(s) at s along the board, extruded through the board."""
    s0, s1 = -BIG / 4, BIG / 4
    outline = Polygon((-half(s0), s0), (half(s0), s0), (half(s1), s1), (-half(s1), s1))
    return outline.on(plane.offset(-BIG / 2)).extrude(BIG)


# The seat's and the base's sides are vertical; the slant's contain its normal (0, 1, 1).
SEAT_SIDES = sides(Plane((0, Y_NOSE, 0), (1, 0, 0), (0, 0, 1)), lambda s: seat_half(Y_NOSE + s))
BASE_SIDES = sides(Plane((0, Y_NOSE, 0), (1, 0, 0), (0, 0, 1)), lambda s: base_half(Y_NOSE + s))
SLANT_SIDES = sides(Plane((0, *NOSE), (1, 0, 0), (0, 1, 1)), lambda s: W_NOSE / 2 - RATE * s)


def back_plane(t: float = 0.0, along: float = 0.0, normal=UP) -> Plane:
    """The back's own frame: x across the chair, y through the back (front face 0, rear face T); its origin on the
    front face at the seat's underside, `along` it upward."""
    y0, z0 = front(SEAT_BOTTOM), SEAT_BOTTOM
    origin = (0.0, y0 + t * ACROSS[1] + along * UP[1], z0 + t * ACROSS[2] + along * UP[2])
    return Plane(origin, (1, 0, 0), normal)


def tails() -> Part:
    """The seat's tails: trapezoids square to the back, wide at its rear face, as prisms along the back, cut to the
    seat's thickness. They show on the back's rear face (and as trapezoids on the seat's faces); the back's pins
    are what they leave of the joint, its end grain on the seat's underside."""
    sketch = None
    for i in range(TAILS):
        x = -W_BACK / 2 + HALF_PIN + TAIL_REAR / 2 + i * (TAIL_REAR + PIN)
        tail = Polygon((x - TAIL_FRONT / 2, 0), (x + TAIL_FRONT / 2, 0), (x + TAIL_REAR / 2, T), (x - TAIL_REAR / 2, T))
        sketch = tail if sketch is None else sketch + tail
    prisms = sketch.on(back_plane(along=-T)).extrude(4 * T)
    slab = Box(BIG, BIG, T, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, SEAT_BOTTOM)
    return prisms & slab


def grip_along() -> float:
    """Where the grip's middle is along the back's rear face, from the seat's underside in the back's frame."""
    top = sum((a - b) * c for a, b, c in zip((0.0, *REAR_TOP), back_plane(t=T).origin.to_tuple(), UP))
    return top - GRIP_BELOW - GRIP_HIGH / 2


def grip() -> Part:
    """The hand grip's pocket, a slot with round ends sunk square into the back's rear face."""
    plane = back_plane(t=T - GRIP_DEEP, along=grip_along(), normal=ACROSS)
    return Slot(GRIP, GRIP_HIGH).on(plane).extrude(GRIP_DEEP)


def model() -> list[Part]:
    cherry = "#a8603a"
    dovetails = tails()
    seat = (side_prism(SEAT) & SEAT_SIDES) + dovetails
    back = side_prism(BACK, W_BACK) - dovetails - grip()
    named = [
        (seat, "seat"),
        (back, "back"),
        (side_prism(SLANT_BOARD) & SLANT_SIDES, "slant"),
        (side_prism(BASE) & BASE_SIDES, "base"),
        # A cleat is flush with the narrower board's sides: each half of it, either side of the mitre plane,
        # takes that board's side planes. (The 1934 originals bolted each mitre through its cleat, eight brass
        # bolts to a mitre; today's production glues them, as here.)
        (side_prism(TOP_CLEAT) & SEAT_SIDES & SLANT_SIDES, "seat cleat"),
        (side_prism(FOOT_CLEAT) & BASE_SIDES & SLANT_SIDES, "foot cleat"),
    ]
    return [part.named(name).colored(cherry) for part, name in named]


def area(polygon: list[tuple[float, float]]) -> float:
    """The shoelace formula."""
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(polygon, polygon[1:] + polygon[:1]))) / 2


def centroid(polygon: list[tuple[float, float]]) -> tuple[float, float]:
    """The centroid of a simple polygon, from the same cross products as its area."""
    a = cy = cz = 0.0
    for (y0, z0), (y1, z1) in zip(polygon, polygon[1:] + polygon[:1]):
        c = y0 * z1 - y1 * z0
        a, cy, cz = a + c, cy + (y0 + y1) * c, cz + (z0 + z1) * c
    return cy / (3 * a), cz / (3 * a)


def tapered(polygon: list[tuple[float, float]], half) -> float:
    """A side-view profile between side planes whose half-width is linear over the profile: the volume is the area
    times the width at the centroid, exact (Cavalieri, slice by slice across the profile)."""
    return area(polygon) * 2 * half(*centroid(polygon))


def mitre_point(through: tuple[float, float], y: float, sign: float) -> tuple[float, float]:
    """Where a mitre line (22.5 degrees, falling backward through `through`) is at y."""
    return y, through[1] - sign * (y - through[0]) * MITRE


def cleat_volume(triangle: list[tuple[float, float]], cut: tuple[float, float], halves) -> float:
    """A cleat, its triangle split by the mitre line at `cut` (on its vertical face): each half is flush with the
    narrower board there. Both widths are linear and equal on the mitre plane, so one is the narrower over all of a
    half, and min() at its centroid picks it."""
    corner, leg, foot = triangle
    total = 0.0
    for half_triangle in ([corner, leg, cut], [corner, cut, foot]):
        c = centroid(half_triangle)
        total += area(half_triangle) * 2 * min(h(*c) for h in halves)
    return total


def assembly_order(by_name: dict[str, Part]) -> None:
    """The chair goes together in this order, each member moving straight in, tested by moving it along its way
    out and finding no overlap at any depth:
    1. the back slides down onto the seat's tails along its own faces (not square to the seat: with the back leaning
       8 degrees, lifting it straight up drives its front face into the seat in front of the joint; measured);
    2. a cleat is glued to the seat's underside, square to it, and one to the base's top;
    3. the slant goes onto the seat along the top mitre's normal, its rear face coming onto the cleat;
    4. the base with its cleat goes onto the slant along the bottom mitre's normal.
    With everything else in place, the slant cannot come out in the side view's plane: the two mitres' normals are
    opposite, and its faces bear on the two cleats from opposite sides (tested: either mitre's normal, and either way
    along the slant, run into something). Along x, the mitres' length, it slides out of all four at once."""

    def overlap(moving: Part, fixed: list[Part], direction, depth: float) -> float:
        moved = moving.translate(*(depth * c for c in direction))
        return sum((moved & f).volume for f in fixed if moved.distance_to(f) < 1e-9)

    def free(moving: list[Part], fixed: list[Part], direction, depths) -> None:
        for d in depths:
            for m in moving:
                assert overlap(m, fixed, direction, d) < 1e-6, (m.name, direction, d)

    seat, back, slant, base = (by_name[n] for n in ("seat", "back", "slant", "base"))
    top_cleat, foot_cleat = by_name["seat cleat"], by_name["foot cleat"]
    free([back], [seat], UP, (0.5, 10, 2 * T + 1))
    lifted = overlap(back, [seat], (0, 0, 1), 0.5)
    assert lifted > 1, lifted  # straight up, the back's front face runs into the seat
    free([top_cleat], [seat, back], (0, 0, -1), (0.5, 10, CLEAT + 1))
    free([foot_cleat], [base], (0, 0, 1), (0.5, 10, CLEAT + 1))
    c, s = math.cos(math.radians(SLANT / 2)), math.sin(math.radians(SLANT / 2))
    top_out, foot_out = (0, -s, -c), (0, -s, -c)  # the slant away from the seat; the base away from the slant
    free([slant], [seat, back, top_cleat], top_out, (0.5, 10, 2 * CLEAT))
    free([base, foot_cleat], [slant, seat, back, top_cleat], foot_out, (0.5, 10, 2 * CLEAT))
    others = [seat, back, top_cleat, base, foot_cleat]
    free([slant], others, (1, 0, 0), (0.5, 10, W_NOSE + 1))
    stuck = [overlap(slant, others, d, 0.5) for d in (top_out, (0, s, c), (0, -1, 1), (0, 1, -1))]
    assert min(stuck) > 1, stuck  # the mitres' normals, and along the slant either way: it runs into something


def check(parts: list[Part]) -> None:
    """Worked out by hand: each board's side view by the shoelace formula, times its width at the centroid where it
    tapers; a dovetail is its trapezoid's area times its length through the seat; the grip a slot's area times its
    depth."""
    tail = (TAIL_REAR + TAIL_FRONT) / 2 * T * T / math.cos(LEAN)  # a prism along the back, cut by two horizontals
    grip_volume = ((GRIP - GRIP_HIGH) * GRIP_HIGH + math.pi * (GRIP_HIGH / 2) ** 2) * GRIP_DEEP
    want = {
        "seat": tapered(SEAT, seat_half) + TAILS * tail,
        "back": area(BACK) * W_BACK - TAILS * tail - grip_volume,
        "slant": tapered(SLANT_BOARD, slant_half),
        "base": tapered(BASE, base_half),
        "seat cleat": cleat_volume(TOP_CLEAT, mitre_point(SEAT_INNER, TOP_CLEAT[1][0], 1), (seat_half, slant_half)),
        "foot cleat": cleat_volume(FOOT_CLEAT, mitre_point(BASE_INNER, FOOT_CLEAT[1][0], 1), (base_half, slant_half)),
    }
    for part in parts:
        w = want[part.name]
        assert part.is_valid() and abs(part.volume - w) < 1e-6 * w, (part.name, part.volume, w)
    by_name = {p.name: p for p in parts}
    whole = None
    for part in parts:
        whole = part if whole is None else whole + part
    # Every tail fills its socket, every mitre and cleat meets its board: the whole is the sum, nothing overlaps.
    total = sum(want.values())
    assert abs(whole.volume - total) < 1e-6 * total, (whole.volume, total)
    assert len(whole.solids()) == 1
    for a, b in (
        ("seat", "back"),
        ("seat", "slant"),
        ("slant", "base"),
        ("seat cleat", "seat"),
        ("seat cleat", "slant"),
        ("foot cleat", "base"),
        ("foot cleat", "slant"),
    ):
        assert by_name[a].distance_to(by_name[b]) < 1e-6, (a, b)  # they touch
    for other in ("slant", "base", "seat cleat", "foot cleat"):
        assert by_name["back"].distance_to(by_name[other]) > 50, other  # the back is held by the seat alone
    # The mitres meet flush: each board's mitre face has the same four corners as the other's.
    for a, b in (("seat", "slant"), ("slant", "base")):
        faces = []
        for name in (a, b):
            planar = [f for f in by_name[name].faces() if f.geom_type == "plane"]
            mitre = [f for f in planar if abs(abs(f.normal_at().z) - math.cos(math.radians(SLANT / 2))) < 1e-9]
            faces.append([f for f in mitre if f.distance_to(by_name[b if name == a else a]) < 1e-6])
        corners = [sorted(v.point.to_tuple() for v in f[0].vertices()) for f in faces]
        assert len(corners[0]) == 4 and all(math.dist(p, q) < 1e-6 for p, q in zip(*corners)), corners
    assert abs(by_name["base"].bbox().min.z) < 1e-6  # flat on the floor
    size = whole.bbox().size
    assert abs(size.x - W_NOSE) < 1e-6 and abs(size.y - DEPTH) < 1e-6 and abs(size.z - HEIGHT) < 5, size
    assert BACK_STEP < 0.05, BACK_STEP
    assembly_order(by_name)
    mass = sum(p.mass_properties(density=CHERRY).mass for p in parts)
    print(f"{len(parts)} parts, {size} mm over all, cherry {mass / 1000:.2f} kg")
    print(
        f"seat {rear(SEAT_TOP) - Y_NOSE:.1f} long on top, slant {along_slant(*FOOT):.1f} from the nose to the foot,"
        f" back {(HEIGHT - SEAT_TOP) / math.cos(LEAN):.1f} above the seat along its rear face"
    )
    print(
        f"widths: {W_NOSE:.1f} at the nose, {2 * seat_half(front(SEAT_TOP)):.1f} at the back, back {W_BACK:.2f},"
        f" {W_FOOT:.1f} at the foot, base front {2 * base_half(BASE_FRONT):.1f}; taper {RATE:.5f} a side;"
        f" step at the back's edges {BACK_STEP:.3f}"
    )
    print(f"tails {TAIL_REAR:.2f} at the back's rear face, {TAIL_FRONT:.2f} at its front face")


if __name__ == "__main__":
    parts = model()
    check(parts)
    export_step(parts, "zigzag_chair.step", assembly=True)
    show(parts)
