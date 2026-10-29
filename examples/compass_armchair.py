"""Cane armchair on compass legs, after the 1955 Chandigarh office chair, measured from a side view; a curved back."""

import math

from smlibpy import *

# Taken off a side photograph at 2.78 mm a pixel (the floor and the 81 cm of the catalogue as the scale), and the
# catalogue: 51 cm over the arms, 55 deep, seat 43-45, arms 66. The chair faces -Y; x = 0 is its middle. The legs,
# the armrest and the back post of a side are boards of one thickness, all in one plane.
W, LEG_T = 480.0, 30.0  # outside width over the boards; their thickness across the chair
FRONT_FOOT, REAR_FOOT = (-181.0, -139.0), (139.0, 181.0)  # the feet on the floor, front edge to back edge
NOTCH_Z = 400.0  # where the two boards of a side part, on the seam y = 0; above it they are one up to the armrest
ARM_EDGES = (-70.0, 70.0)  # the two boards' outer edges where they meet the armrest: the V is isosceles
SPLINE, SPLINE_Z = (20.0, 16.0), 457.0  # a loose tenon on the seam, across and thick, from this height up
SPLINE_IN_ARM = 40.0  # how far it goes on into the armrest
ARM_TOP, ARM_FRONT = 645.0, -235.0  # the armrest, a blade on edge: its level top and its nose
ARM_HEIGHT = ((-235.0, 60.0), (280.0, 95.0))  # (y, height) at the nose and at the back: the underside slopes
SEAT_TOP, RAIL_H, RAIL_T, CANE = 437.0, 60.0, 25.0, 8.0  # the seat frame: top, rail height and thickness; cane
SEAT_Y, FRONT_RAIL_T, REAR_RAIL_T = (-229.0, 240.0), 30.0, 40.0  # the side rails, nose to back; the cross rails
TENON, LEG_TENON_Y = (20.0, 10.0, 40.0), (-55.0, 55.0)  # into the leg or the rail, thick, high; where the legs get it
BACK_TILT, POST = 15.0, (30.0, 34.0)  # the back leans 15 degrees; a post: across, deep
POST_Y_AT_ARM = 260.0  # the posts' axis at the armrest's top
RAIL_D = 24.0  # the back's rails are this deep, less than the posts: the arc's bow hides within the posts' depth
BACK_RAILS, BACK_TENON = ((65.0, 100.0), (330.0, 365.0)), (20.0, 10.0, 20.0)  # along the posts, from seat height
BIG = 3000.0

X_BOARD = W / 2 - LEG_T  # the inner face of a side's boards
LEAN = math.radians(BACK_TILT)
POST_Y = POST_Y_AT_ARM - (ARM_TOP - SEAT_TOP) * math.tan(LEAN)  # the posts' axis at seat height
BOW = POST[1] - RAIL_D  # the arc's inner line bows this much (10 mm) over the half chord between the posts
R_BACK = (X_BOARD**2 + BOW**2) / (2 * BOW) + RAIL_D / 2  # the radius of the arc's middle line
# The arc's center: the rails' rear face is flush with the posts' rear face at the middle, their front face with
# the posts' front face at the ends, so that nothing of the back shows beyond the posts in a side view.
ARC_Y = POST[1] / 2 - (R_BACK + RAIL_D / 2)
Y_END = ARC_Y + math.sqrt(R_BACK**2 - X_BOARD**2)  # the arc's middle line where it meets a post


def underside(y: float) -> float:
    """The armrest's lower face: a straight slope from the nose to the back."""
    (y0, h0), (y1, h1) = ARM_HEIGHT
    return ARM_TOP - h0 - (h1 - h0) * (y - y0) / (y1 - y0)


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
# Its mirror image about the seam, but for the top: both boards' tops follow the armrest's sloping underside.
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
    """From the back's own frame (upright, its origin at seat height) to the chair: leaned back 15 degrees."""
    return Pos(0, POST_Y, SEAT_TOP) * (Rot(x=-BACK_TILT) * shape)


def behind_the_posts() -> Part:
    """The half space in front of the posts' rear face, to cut the armrests flush with it."""
    face = tilt(Box(BIG, BIG, BIG, align=(Align.CENTER, Align.MAX, Align.CENTER)))
    return face.translate(0, POST[1] / 2 * math.cos(LEAN), -POST[1] / 2 * math.sin(LEAN))


def arc_band(r_in: float, r_out: float) -> Sketch:
    """The back's curve between two radii, from post to post: concave toward the sitter."""
    band = (Circle(r_out) - Circle(r_in)).translate(0, ARC_Y, 0)
    return band & Rectangle(2 * X_BOARD, BIG, align=(Align.CENTER, Align.MIN)).translate(0, ARC_Y, 0)


def model() -> list[Part]:
    teak, cane = "#9b6a3c", "#e6d2a0"
    x_rail = X_BOARD - RAIL_T  # the side rails' inner faces
    x_mid = X_BOARD + LEG_T / 2  # the middle of a board's thickness, where the half laps part
    z_tenon = SEAT_TOP - RAIL_H / 2
    arm_prism = side_prism(ARM_PROFILE, X_BOARD, LEG_T)  # the armrest before its back is cut
    post_full = Box(POST[0], POST[1], BACK_RAILS[1][1] - BACK_RAILS[0][0], align=(Align.MIN, Align.CENTER, Align.MIN))
    post_full = tilt(post_full.translate(X_BOARD, 0, BACK_RAILS[0][0]))  # the post before its lap, floating
    inner = Box(BIG, BIG, BIG, align=(Align.MAX, Align.CENTER, Align.CENTER)).translate(x_mid, 0, 0)  # x up to x_mid
    outer = Box(BIG, BIG, BIG, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(x_mid, 0, 0)
    parts = []
    for side in (1, -1):
        front, rear = side_prism(FRONT_LEG, X_BOARD, LEG_T), side_prism(REAR_LEG, X_BOARD, LEG_T)
        spline = Box(*SPLINE, underside(0) + SPLINE_IN_ARM - SPLINE_Z, align=(Align.CENTER, Align.CENTER, Align.MIN))
        spline = spline.translate(x_mid, 0, SPLINE_Z)  # through the seam and on into the armrest
        tenons = [
            Box(*TENON, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(X_BOARD, y, z_tenon)
            for y in LEG_TENON_Y
        ]
        front -= [spline, tenons[0]]  # its half of the spline's slot, and the side rail's tenon
        rear -= [spline, tenons[1]]
        rail = Box(RAIL_T, SEAT_Y[1] - SEAT_Y[0], RAIL_H, align=(Align.MAX, Align.MIN, Align.MAX)).translate(
            X_BOARD, SEAT_Y[0], SEAT_TOP
        )
        rail += tenons
        for y0, t in ((SEAT_Y[0], FRONT_RAIL_T), (SEAT_Y[1] - REAR_RAIL_T, REAR_RAIL_T)):  # the cross rails' mortises
            rail -= Box(*TENON, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(x_rail, y0 + t / 2, z_tenon)
        # The armrest, cut flush with the post's back, crosses the post in a half lap: it keeps the outer half, the
        # post the inner one. The spline's top is mortised into it.
        arm = (arm_prism & behind_the_posts()) - [post_full & inner, spline]
        post = post_full - (arm_prism & outer)
        post -= [
            tilt(
                Box(*BACK_TENON, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(X_BOARD, Y_END, (z0 + z1) / 2)
            )
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
            parts.append((p.mirror(Plane.YZ) if side < 0 else p).named(name).colored(teak))

    def cross_rail(y0: float, t: float) -> Part:
        rail = Box(2 * x_rail, t, RAIL_H, align=(Align.CENTER, Align.MIN, Align.MAX)).translate(0, y0, SEAT_TOP)
        for s in (1, -1):
            rail += Box(*TENON, align=(Align.MIN if s > 0 else Align.MAX, Align.CENTER, Align.CENTER)).translate(
                s * x_rail, y0 + t / 2, z_tenon
            )
        return rail

    parts.append(cross_rail(SEAT_Y[0], FRONT_RAIL_T).named("front rail").colored(teak))
    parts.append(cross_rail(SEAT_Y[1] - REAR_RAIL_T, REAR_RAIL_T).named("rear rail").colored(teak))
    # The cane is a flat panel that touches its rails: the weave is not modelled.
    seat = Box(
        2 * x_rail, SEAT_Y[1] - REAR_RAIL_T - SEAT_Y[0] - FRONT_RAIL_T, CANE, align=(Align.CENTER, Align.MIN, Align.MAX)
    )
    parts.append(seat.translate(0, SEAT_Y[0] + FRONT_RAIL_T, SEAT_TOP).named("seat cane").colored(cane))
    for member, name in back_frame():
        parts.append(tilt(member).named(name).colored(cane if name == "back cane" else teak))
    return parts


def back_frame() -> list[tuple[Part, str]]:
    """The back's rails and cane panel, in the back's own frame: arcs that stay within the posts' depth."""
    members = []
    for z0, z1 in BACK_RAILS:
        rail = arc_band(R_BACK - RAIL_D / 2, R_BACK + RAIL_D / 2).extrude(z1 - z0).translate(0, 0, z0)
        for s in (1, -1):
            rail += Box(*BACK_TENON, align=(Align.MIN if s > 0 else Align.MAX, Align.CENTER, Align.CENTER)).translate(
                s * X_BOARD, Y_END, (z0 + z1) / 2
            )
        members.append((rail, "back rail"))
    panel = arc_band(R_BACK - CANE / 2, R_BACK + CANE / 2).extrude(BACK_RAILS[1][0] - BACK_RAILS[0][1])
    members.append((panel.translate(0, 0, BACK_RAILS[0][1]), "back cane"))
    return members


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
    (y0, h0), (y1, h1) = ARM_HEIGHT
    # the underside: z = ARM_TOP - h0 - slope (y - y0); the face: y = a + b z
    slope, a = (h1 - h0) / (y1 - y0), post_face(0, side)
    b = math.tan(LEAN)
    y = (a + b * (ARM_TOP - h0 + slope * y0)) / (1 + b * slope)
    return y, underside(y)


BACK = ("back post", "back rail", "back cane")


def check(parts: list[Part]) -> None:
    """Worked out by hand: side-view polygons by the shoelace formula, arcs by their integral, prisms by Cavalieri."""
    x_rail = X_BOARD - RAIL_T
    tenon, back_tenon = math.prod(TENON), math.prod(BACK_TENON)
    spline = SPLINE[0] * SPLINE[1] * (underside(0) + SPLINE_IN_ARM - SPLINE_Z)  # a box
    # what the spline takes out of the armrest: a prism between the slope, through its centroid, and its level top
    arm_mortise = SPLINE[0] * SPLINE[1] * SPLINE_IN_ARM
    # each board's half of the spline's slot, cut on the slope at its own centroid
    half_slot = [SPLINE[0] * SPLINE[1] / 2 * (underside(y) - SPLINE_Z) for y in (-SPLINE[1] / 4, SPLINE[1] / 4)]
    # the armrest in the side view, cut at the post's back; and where the post's two faces cross it
    arm_profile = [ARM_PROFILE[0], ARM_PROFILE[1], (post_face(ARM_TOP, 1), ARM_TOP), meet_underside(1)]
    crossing = [
        (post_face(ARM_TOP, -1), ARM_TOP),
        (post_face(ARM_TOP, 1), ARM_TOP),
        meet_underside(1),
        meet_underside(-1),
    ]
    lap = area(crossing) * LEG_T / 2  # the half each of them gives up
    rail_h, panel_h = BACK_RAILS[0][1] - BACK_RAILS[0][0], BACK_RAILS[1][0] - BACK_RAILS[0][1]
    plain = {  # every member without its joinery
        "front leg": area(FRONT_LEG) * LEG_T,
        "rear leg": area(REAR_LEG) * LEG_T,
        "spline": spline,
        "side rail": RAIL_T * (SEAT_Y[1] - SEAT_Y[0]) * RAIL_H,
        "armrest": area(arm_profile) * LEG_T,
        "back post": POST[0] * POST[1] * (BACK_RAILS[1][1] - BACK_RAILS[0][0]),
        "front rail": 2 * x_rail * FRONT_RAIL_T * RAIL_H,
        "rear rail": 2 * x_rail * REAR_RAIL_T * RAIL_H,
        "seat cane": 2 * x_rail * (SEAT_Y[1] - REAR_RAIL_T - SEAT_Y[0] - FRONT_RAIL_T) * CANE,
        "back rail": arc_band_area(R_BACK - RAIL_D / 2, R_BACK + RAIL_D / 2, X_BOARD) * rail_h,
        "back cane": arc_band_area(R_BACK - CANE / 2, R_BACK + CANE / 2, X_BOARD) * panel_h,
    }
    joinery = {
        "front leg": -half_slot[0] - tenon,
        "rear leg": -half_slot[1] - tenon,
        "armrest": -lap - arm_mortise,
        "back post": -lap - 2 * back_tenon,
        "front rail": 2 * tenon,
        "rear rail": 2 * tenon,
        "back rail": 2 * back_tenon,
    }
    for part in parts:
        want = plain[part.name] + joinery.get(part.name, 0)
        assert part.is_valid() and abs(part.volume - want) < 1e-6 * want, (part.name, part.volume, want)
    whole = parts[0]
    for part in parts[1:]:
        whole += part
    # What lies within another member and would be counted twice: the splines, and the crossing of arm and post.
    # Tenons fill their mortises exactly, so nothing else is counted twice, and nothing is missing.
    inside = 2 * spline + 2 * area(crossing) * LEG_T
    want = sum(plain[p.name] for p in parts) - inside
    assert abs(whole.volume - want) < 1e-6 * want, (whole.volume, want)
    assert len(whole.solids()) == 1  # one piece: the back hangs on the armrests
    by_name: dict[str, list[Part]] = {}
    for part in parts:
        by_name.setdefault(part.name, []).append(part)
    for a, b in (
        ("armrest", "front leg"),
        ("armrest", "rear leg"),
        ("armrest", "spline"),
        ("armrest", "back post"),
        ("back post", "back rail"),
        ("back cane", "back rail"),
        ("side rail", "front leg"),
        ("seat cane", "front rail"),
        ("rear leg", "front leg"),
    ):
        assert by_name[a][0].distance_to(by_name[b][0]) < 1e-6, (a, b)  # they touch
    for name in BACK:  # the back is held by the armrests alone: it touches nothing else
        for other in by_name:
            if other not in BACK and other != "armrest":
                assert by_name[name][0].distance_to(by_name[other][0]) > 0.5, (name, other)
    for name in ("front leg", "rear leg"):
        assert all(abs(p.bbox().min.z) < 1e-6 for p in by_name[name]), name  # feet flat on the floor
    for member, name in back_frame():  # in the back's own frame: nothing of it before or behind the posts
        box = member.bbox()
        assert box.min.y > -POST[1] / 2 - 1e-6 and box.max.y < POST[1] / 2 + 1e-6, (name, box.min.y, box.max.y)
    teak = sum(p.mass_properties(density=0.65e-3).mass for p in parts if "cane" not in p.name)
    print(f"{len(parts)} parts, {whole.bbox().size} mm over all, teak {teak / 1000:.2f} kg")


if __name__ == "__main__":
    parts = model()
    check(parts)
    export_step(parts, "compass_armchair.step", assembly=True)
    show(parts)
