"""Cane armchair on compass legs, after the 1955 Chandigarh office chair, measured from a side view; a curved back."""

import math

from smlibpy import *

# Taken off a side photograph at 2.78 mm a pixel (the floor and the 81 cm of the catalogue as the scale), and the
# catalogue: 51 cm over the arms, 55 deep, seat 43-45, arms 66. The chair faces -Y; x = 0 is its middle.
W, LEG_T = 480.0, 30.0  # outside width over the legs; a leg board's thickness across the chair
FRONT_FOOT, REAR_FOOT = (-181.0, -139.0), (262.0, 318.0)  # the feet on the floor, front edge to back edge
NOTCH_Z = 400.0  # where the two boards of a side part, on the seam y = 0; above it they are one up to the armrest
ARM_EDGES = (-70.0, 58.0)  # the two boards' outer edges where they meet the armrest
SPLINE, SPLINE_Z = (20.0, 16.0), 457.0  # a loose tenon across the seam: across, thick; from its foot up to the arm
ARM_W, ARM_TOP, ARM_FRONT = 65.0, 645.0, -235.0  # the armrest plank: wide, its top and its nose
ARM_T = ((-235.0, 32.0), (280.0, 58.0))  # a wedge: thin at the nose, thick at the back (y, thickness)
SEAT_TOP, RAIL_H, RAIL_T, CANE = 437.0, 60.0, 25.0, 8.0  # the seat frame: top, rail height and thickness; cane
SEAT_Y, FRONT_RAIL_T, REAR_RAIL_T = (-229.0, 240.0), 30.0, 40.0  # the side rails, nose to back; the cross rails
TENON, LEG_TENON_Y = (20.0, 10.0, 40.0), (-55.0, 70.0)  # into the leg or the rail, thick, high; where the legs get it
BACK_TILT, POST, POST_X = 15.0, (30.0, 34.0), 177.5  # the back leans 15 degrees; a post: across, deep; inner face
POST_Y_AT_ARM, BACK_TOP = 260.0, 790.0  # the posts' axis at the armrest's top; the top of the back
R_BACK, RAIL_D = 700.0, 32.0  # the back is an arc: the radius of its middle line; its rails are this deep
BACK_RAILS, BACK_TENON = ((65.0, 100.0), (330.0, 365.0)), (20.0, 10.0, 20.0)  # along the posts, from the seat
BIG = 3000.0

LEAN = math.radians(BACK_TILT)
POST_Y = POST_Y_AT_ARM - (ARM_TOP - SEAT_TOP) * math.tan(LEAN)  # the posts' axis at the seat
ARC_Y = -math.sqrt(R_BACK**2 - POST_X**2)  # the arc's center, so that its middle line passes through the posts' axes


def underside(y: float) -> float:
    """The armrest's lower face: a straight slope from the nose to the back."""
    (y0, t0), (y1, t1) = ARM_T
    return ARM_TOP - t0 - (t1 - t0) * (y - y0) / (y1 - y0)


def post_face(z: float, side: float) -> float:
    """y of a post's front (side -1) or rear (+1) face at height z, in the side view."""
    return POST_Y + (z - SEAT_TOP) * math.tan(LEAN) + side * POST[1] / 2 / math.cos(LEAN)


FRONT_LEG = [
    (FRONT_FOOT[0], 0),
    (FRONT_FOOT[1], 0),
    (0, NOTCH_Z),
    (0, underside(0)),
    (ARM_EDGES[0], underside(ARM_EDGES[0])),
]
REAR_LEG = [
    (REAR_FOOT[0], 0),
    (REAR_FOOT[1], 0),
    (ARM_EDGES[1], underside(ARM_EDGES[1])),
    (0, underside(0)),
    (0, NOTCH_Z),
]
ARM_PROFILE = [(ARM_FRONT, underside(ARM_FRONT)), (ARM_FRONT, ARM_TOP), (900.0, ARM_TOP), (900.0, underside(900.0))]


def side_prism(profile: list[tuple[float, float]], x_min: float, thickness: float) -> Part:
    """A board seen from the side: its profile in (y, z), extruded across the chair from x_min."""
    board = Polygon(*profile).on(Plane.YZ).extrude(thickness)
    return board.translate(x_min - board.bbox().min.x, 0, 0)


def tilt(shape):
    """From the back's own frame (upright, its foot at the origin) to the chair: leaned back and set on the seat frame."""
    return Pos(0, POST_Y, SEAT_TOP) * (Rot(x=-BACK_TILT) * shape)


def behind_the_posts() -> Part:
    """The half space in front of the posts' rear face, to cut the armrests flush with it."""
    face = tilt(Box(BIG, BIG, BIG, align=(Align.CENTER, Align.MAX, Align.CENTER)))
    return face.translate(0, POST[1] / 2 * math.cos(LEAN), -POST[1] / 2 * math.sin(LEAN))


def arc_band(r_in: float, r_out: float) -> Sketch:
    """The back's curve between two radii, from post to post: concave toward the sitter."""
    band = (Circle(r_out) - Circle(r_in)).translate(0, ARC_Y, 0)
    return band & Rectangle(2 * POST_X, BIG, align=(Align.CENTER, Align.MIN)).translate(0, ARC_Y, 0)


def model() -> list[Part]:
    teak, cane = "#9b6a3c", "#e6d2a0"
    x_leg = W / 2 - LEG_T  # the legs' inner faces
    x_rail = x_leg - RAIL_T  # the side rails' inner faces
    z_tenon = SEAT_TOP - RAIL_H / 2
    arm_prism = side_prism(ARM_PROFILE, x_leg + LEG_T / 2 - ARM_W / 2, ARM_W)  # the armrest before its back is cut
    parts = []
    for side in (1, -1):

        def place(p: Part) -> Part:
            return p.mirror(Plane.YZ) if side < 0 else p

        front, rear = side_prism(FRONT_LEG, x_leg, LEG_T), side_prism(REAR_LEG, x_leg, LEG_T)
        spline = Box(*SPLINE, ARM_TOP - SPLINE_Z, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(
            x_leg + LEG_T / 2, 0, SPLINE_Z
        )
        spline -= arm_prism  # cut to the armrest's underside, like the boards it joins
        tenons = [
            Box(*TENON, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(x_leg, y, z_tenon) for y in LEG_TENON_Y
        ]
        front -= [spline, tenons[0]]  # its half of the spline's slot, and the side rail's tenon
        rear -= [spline, tenons[1]]
        rail = Box(RAIL_T, SEAT_Y[1] - SEAT_Y[0], RAIL_H, align=(Align.MAX, Align.MIN, Align.MAX)).translate(
            x_leg, SEAT_Y[0], SEAT_TOP
        )
        rail += tenons
        for y0, t in ((SEAT_Y[0], FRONT_RAIL_T), (SEAT_Y[1] - REAR_RAIL_T, REAR_RAIL_T)):  # the cross rails' mortises
            rail -= Box(*TENON, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(x_rail, y0 + t / 2, z_tenon)
        arm = arm_prism & behind_the_posts()
        post = Box(POST[0], POST[1], BACK_RAILS[1][1] + 60, align=(Align.MIN, Align.CENTER, Align.MIN)).translate(
            POST_X, 0, -30
        )
        post = tilt(post) & Box(BIG, BIG, BACK_TOP - SEAT_TOP, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(
            0, 0, SEAT_TOP
        )
        post -= arm_prism  # the notch the armrest runs through, flush with the post's back
        post -= [
            tilt(Box(*BACK_TENON, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(POST_X, 0, (z0 + z1) / 2))
            for z0, z1 in BACK_RAILS
        ]
        for p, name in (
            (front, "front leg"),
            (rear, "rear leg"),
            (spline, "spline"),
            (rail, "side rail"),
            (arm, "armrest"),
            (post, "back post"),
        ):
            parts.append(place(p).named(name).colored(teak))

    def cross_rail(y0: float, t: float) -> Part:
        rail = Box(2 * x_rail, t, RAIL_H, align=(Align.CENTER, Align.MIN, Align.MAX)).translate(0, y0, SEAT_TOP)
        for s in (1, -1):
            rail += Box(*TENON, align=(Align.MIN if s > 0 else Align.MAX, Align.CENTER, Align.CENTER)).translate(
                s * x_rail, y0 + t / 2, z_tenon
            )
        return rail

    parts.append(cross_rail(SEAT_Y[0], FRONT_RAIL_T).named("front rail").colored(teak))
    parts.append(cross_rail(SEAT_Y[1] - REAR_RAIL_T, REAR_RAIL_T).named("rear rail").colored(teak))
    seat = Box(
        2 * x_rail, SEAT_Y[1] - REAR_RAIL_T - SEAT_Y[0] - FRONT_RAIL_T, CANE, align=(Align.CENTER, Align.MIN, Align.MAX)
    )
    parts.append(seat.translate(0, SEAT_Y[0] + FRONT_RAIL_T, SEAT_TOP).named("seat cane").colored(cane))
    for z0, z1 in BACK_RAILS:
        rail = arc_band(R_BACK - RAIL_D / 2, R_BACK + RAIL_D / 2).extrude(z1 - z0).translate(0, 0, z0)
        for s in (1, -1):
            rail += Box(*BACK_TENON, align=(Align.MIN if s > 0 else Align.MAX, Align.CENTER, Align.CENTER)).translate(
                s * POST_X, 0, (z0 + z1) / 2
            )
        parts.append(tilt(rail).named("back rail").colored(teak))
    panel = (
        arc_band(R_BACK - CANE / 2, R_BACK + CANE / 2)
        .extrude(BACK_RAILS[1][0] - BACK_RAILS[0][1])
        .translate(0, 0, BACK_RAILS[0][1])
    )
    parts.append(tilt(panel).named("back cane").colored(cane))
    return parts


def area(polygon: list[tuple[float, float]]) -> float:
    """The shoelace formula."""
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(polygon, polygon[1:] + polygon[:1]))) / 2


def arc_band_area(r_in: float, r_out: float, half_width: float) -> float:
    """Between two concentric arcs, cut square at x = +-half_width: the integral of sqrt(r^2 - x^2), closed form."""

    def under(r: float) -> float:
        return half_width * math.sqrt(r**2 - half_width**2) + r**2 * math.asin(half_width / r)

    return under(r_out) - under(r_in)


def meet_underside(side: float) -> tuple[float, float]:
    """Where a post's face (front -1, rear +1) crosses the armrest's underside, in the side view."""
    (y0, t0), (y1, t1) = ARM_T
    # the underside: z = ARM_TOP - t0 - slope (y - y0); the face: y = a + b z
    slope, a = (t1 - t0) / (y1 - y0), post_face(0, side)
    b = math.tan(LEAN)
    y = (a + b * (ARM_TOP - t0 + slope * y0)) / (1 + b * slope)
    return y, underside(y)


def check(parts: list[Part]) -> None:
    """Worked out by hand: side-view polygons by the shoelace formula, arcs by their integral, prisms by Cavalieri."""
    x_leg = W / 2 - LEG_T
    x_rail = x_leg - RAIL_T
    tenon, back_tenon = math.prod(TENON), math.prod(BACK_TENON)
    # the spline: a prism cut by the floor of its slot and by the arm's slope, so its axis through its centroid
    spline = SPLINE[0] * SPLINE[1] * (underside(0) - SPLINE_Z)
    # the armrest in the side view, cut at the post's back; the notch, where the post's two faces cross the arm
    arm_profile = [ARM_PROFILE[0], ARM_PROFILE[1], (post_face(ARM_TOP, 1), ARM_TOP), meet_underside(1)]
    notch_profile = [
        (post_face(ARM_TOP, -1), ARM_TOP),
        (post_face(ARM_TOP, 1), ARM_TOP),
        meet_underside(1),
        meet_underside(-1),
    ]
    notch_width = POST_X + POST[0] - (x_leg + LEG_T / 2 - ARM_W / 2)  # the post's outer slice the arm runs through
    rail_h, panel_h = BACK_RAILS[0][1] - BACK_RAILS[0][0], BACK_RAILS[1][0] - BACK_RAILS[0][1]
    plain = {  # every member without its joinery
        "front leg": area(FRONT_LEG) * LEG_T,
        "rear leg": area(REAR_LEG) * LEG_T,
        "spline": spline,
        "side rail": RAIL_T * (SEAT_Y[1] - SEAT_Y[0]) * RAIL_H,
        "armrest": area(arm_profile) * ARM_W,
        "back post": POST[0] * POST[1] * (BACK_TOP - SEAT_TOP) / math.cos(LEAN),
        "front rail": 2 * x_rail * FRONT_RAIL_T * RAIL_H,
        "rear rail": 2 * x_rail * REAR_RAIL_T * RAIL_H,
        "seat cane": 2 * x_rail * (SEAT_Y[1] - REAR_RAIL_T - SEAT_Y[0] - FRONT_RAIL_T) * CANE,
        "back rail": arc_band_area(R_BACK - RAIL_D / 2, R_BACK + RAIL_D / 2, POST_X) * rail_h,
        "back cane": arc_band_area(R_BACK - CANE / 2, R_BACK + CANE / 2, POST_X) * panel_h,
    }
    # each board's half of the slot, cut on the slope at its own centroid
    half_slot = [SPLINE[0] * SPLINE[1] / 2 * (underside(y) - SPLINE_Z) for y in (-SPLINE[1] / 4, SPLINE[1] / 4)]
    joinery = {
        "front leg": -half_slot[0] - tenon,
        "rear leg": -half_slot[1] - tenon,
        "side rail": 2 * tenon - 2 * tenon,
        "front rail": 2 * tenon,
        "rear rail": 2 * tenon,
        "back rail": 2 * back_tenon,
        "back post": -area(notch_profile) * notch_width - 2 * back_tenon,
    }
    for part in parts:
        want = plain[part.name] + joinery.get(part.name, 0)
        assert part.is_valid() and abs(part.volume - want) < 1e-6 * want, (part.name, part.volume, want)
    whole = parts[0]
    for part in parts[1:]:
        whole += part
    # what lies within another member and would be counted twice: the splines, the arms where they run through the posts
    inside = 2 * spline + 2 * area(notch_profile) * notch_width
    want = sum(plain[p.name] for p in parts) - inside  # tenons fill their mortises exactly: no gap, no overlap
    assert abs(whole.volume - want) < 1e-6 * want, (whole.volume, want)
    by_name: dict[str, list[Part]] = {}
    for part in parts:
        by_name.setdefault(part.name, []).append(part)
    for a, b in (
        ("armrest", "front leg"),
        ("armrest", "rear leg"),
        ("armrest", "spline"),
        ("armrest", "back post"),
        ("back post", "rear rail"),
        ("seat cane", "front rail"),
        ("back cane", "back rail"),
        ("rear leg", "front leg"),
    ):
        assert by_name[a][0].distance_to(by_name[b][0]) < 1e-6, (a, b)  # they touch
    for name in ("front leg", "rear leg"):
        assert all(abs(p.bbox().min.z) < 1e-6 for p in by_name[name]), name  # feet flat on the floor
    teak = sum(p.mass_properties(density=0.65e-3).mass for p in parts if "cane" not in p.name)
    print(f"{len(parts)} parts, {whole.bbox().size} mm over all, teak {teak / 1000:.2f} kg")


if __name__ == "__main__":
    parts = model()
    check(parts)
    export_step(parts, "compass_armchair.step", assembly=True)
    show(parts)
