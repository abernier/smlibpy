"""Cane armchair on compass legs: teak, the rear legs butting against the front, the seat tenoned in, a tilted back."""

import math

from smlibpy import *

W = 520.0  # outside width over the legs
LEG = (30.0, 35.0)  # a leg's section: across the chair, and in its own plane
FRONT_FOOT, FRONT_LEAN = -265.0, math.degrees(math.atan(75 / 610))  # the front leg leans back 75 mm over 610
REAR_FOOT, REAR_LEAN = 240.0, 36.0  # the rear leg leans forward until it meets the front leg
ARM_UNDER, ARM_TOP, ARM_W, ARM_Y = 610.0, 640.0, 60.0, (-250.0, 240.0)  # the armrest plank
SEAT_TOP, RAIL_H, RAIL_T = 430.0, 50.0, 25.0  # seat frame: top, rail height, rail thickness
SEAT_Y = (-245.0, 200.0)  # the side rails, front end to back end
REAR_RAIL_T, CANE = 40.0, 8.0  # the rear rail is as deep as the back posts; cane panels
TENON = (20.0, 10.0, 30.0)  # into the leg or rail, thick, high
BACK_TILT, POST = 12.0, (25.0, 40.0)  # the back leans 12 degrees; a post's section
BACK_RAILS = ((40.0, 70.0), (140.0, 170.0))  # the back rails, in the back's own frame, above the rear seat rail
BACK_TENON = (20.0, 10.0, 20.0)
BIG = 2000.0


def lean_axis(lean: float, length: float, start: float = -50.0) -> Part:
    """A leg blank: a prism along an axis in the YZ plane that leans ``lean`` degrees from vertical.

    Positive lean tips the top toward -Y (forward); the axis starts ``start`` mm before the origin.
    """
    blank = Box(LEG[0], LEG[1], length, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, start)
    return Rot(x=lean) * blank


def rear_leg_length() -> float:
    """Along its axis, from the floor to the rear face of the front leg (plain trigonometry, no kernel)."""
    front, rear = math.radians(FRONT_LEAN), math.radians(REAR_LEAN)
    # the front leg's rear face: offset LEG[1] / 2 from its axis along the normal (cos, -sin) in (y, z)
    return ((REAR_FOOT - FRONT_FOOT) * math.cos(front) - LEG[1] / 2) / math.sin(rear + front)


def legs(x: float) -> tuple[Part, Part]:
    """The front and rear legs of one side, cut flat on the floor, the rear one butting against the front."""
    slab = Box(BIG, BIG, ARM_UNDER, align=(Align.CENTER, Align.CENTER, Align.MIN))
    front = (lean_axis(-FRONT_LEAN, 760).translate(x, FRONT_FOOT, 0)) & slab
    rear = lean_axis(REAR_LEAN, rear_leg_length() + 75).translate(x, REAR_FOOT, 0)
    rear = (rear - lean_axis(-FRONT_LEAN, 900).translate(x, FRONT_FOOT, 0)) & slab
    return front, rear


def y_on_leg(foot: float, lean: float, z: float) -> float:
    """Where a leg's axis is at height z."""
    return foot - z * math.tan(math.radians(lean))


def seat_tenon(x: float, y: float, z: float) -> Part:
    """A side rail's tenon, going outward into a leg at (x, y, z), its center."""
    return Box(*TENON, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(x, y, z)


def model() -> list[Part]:
    teak, cane = "#9b6a3c", "#e6d2a0"
    xl = W / 2 - LEG[0]  # the legs' inner face
    xr = xl - RAIL_T  # the side rails' inner face
    zt = SEAT_TOP - RAIL_H / 2  # the tenons' height
    parts = []
    for side in (1, -1):
        mirror = (lambda p: p.mirror(Plane.YZ)) if side < 0 else (lambda p: p)
        front, rear = legs(xl + LEG[0] / 2)
        tenons = [
            seat_tenon(xl, y_on_leg(FRONT_FOOT, -FRONT_LEAN, zt), zt),
            seat_tenon(xl, y_on_leg(REAR_FOOT, REAR_LEAN, zt), zt),
        ]
        front -= tenons[0]
        rear -= tenons[1]
        rail = Box(RAIL_T, SEAT_Y[1] - SEAT_Y[0], RAIL_H, align=(Align.MAX, Align.MIN, Align.MAX)).translate(
            xl, SEAT_Y[0], SEAT_TOP
        )
        rail += tenons
        for y0, t in ((SEAT_Y[0], RAIL_T), (SEAT_Y[1] - REAR_RAIL_T, REAR_RAIL_T)):  # the mortises of the cross rails
            rail -= Box(TENON[0], TENON[1], TENON[2], align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(
                xr, y0 + t / 2, zt
            )
        arm = Box(ARM_W, ARM_Y[1] - ARM_Y[0], ARM_TOP - ARM_UNDER, align=(Align.CENTER, Align.MIN, Align.MIN))
        arm = arm.translate(xl + LEG[0] / 2, ARM_Y[0], ARM_UNDER)
        parts += [
            mirror(p).named(n).colored(teak)
            for p, n in ((front, "front leg"), (rear, "rear leg"), (rail, "side rail"), (arm, "armrest"))
        ]

    def cross_rail(y0: float, t: float) -> Part:
        rail = Box(2 * xr, t, RAIL_H, align=(Align.CENTER, Align.MIN, Align.MAX)).translate(0, y0, SEAT_TOP)
        for s in (1, -1):
            rail += Box(
                TENON[0], TENON[1], TENON[2], align=(Align.MIN if s > 0 else Align.MAX, Align.CENTER, Align.CENTER)
            ).translate(s * xr, y0 + t / 2, zt)
        return rail

    parts.append(cross_rail(SEAT_Y[0], RAIL_T).named("front rail").colored(teak))
    parts.append(cross_rail(SEAT_Y[1] - REAR_RAIL_T, REAR_RAIL_T).named("rear rail").colored(teak))
    seat = Box(2 * xr, SEAT_Y[1] - REAR_RAIL_T - (SEAT_Y[0] + RAIL_T), CANE, align=(Align.CENTER, Align.MIN, Align.MAX))
    parts.append(seat.translate(0, SEAT_Y[0] + RAIL_T, SEAT_TOP).named("seat cane").colored(cane))

    # The back, built upright on the rear rail and then tilted about the rail's top edge.
    pivot = Pos(0, SEAT_Y[1] - REAR_RAIL_T / 2, SEAT_TOP)

    def tilt(p):
        return pivot * (Rot(x=-BACK_TILT) * p)

    posts = [
        Box(POST[0], POST[1], 260, align=(Align.MIN if s > 0 else Align.MAX, Align.CENTER, Align.MIN)).translate(
            s * xr, 0, -30
        )
        for s in (1, -1)
    ]
    rails, back_tenons = [], []
    for z0, z1 in BACK_RAILS:
        rail = Box(2 * xr, POST[1], z1 - z0, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, z0)
        for s in (1, -1):
            tenon = Box(*BACK_TENON, align=(Align.MIN if s > 0 else Align.MAX, Align.CENTER, Align.CENTER)).translate(
                s * xr, 0, (z0 + z1) / 2
            )
            rail += tenon
            back_tenons.append(tenon)
        rails.append(rail)
    posts = [p - back_tenons for p in posts]
    panel = Box(
        2 * xr, CANE, BACK_RAILS[1][0] - BACK_RAILS[0][1], align=(Align.CENTER, Align.CENTER, Align.MIN)
    ).translate(0, 0, BACK_RAILS[0][1])
    slab = Box(BIG, BIG, ARM_UNDER - SEAT_TOP, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, SEAT_TOP)
    parts += [(tilt(p) & slab).named("back post").colored(teak) for p in posts]
    parts += [tilt(r).named("back rail").colored(teak) for r in rails]
    parts.append(tilt(panel).named("back cane").colored(cane))
    return parts


def check(parts: list[Part]) -> None:
    """Worked out by hand: a prism cut by two planes has its section times the axis between the planes (Cavalieri)."""
    xr = W / 2 - LEG[0] - RAIL_T
    leg_area, tenon, back_tenon = LEG[0] * LEG[1], math.prod(TENON), math.prod(BACK_TENON)
    plain = {  # every member without its joinery
        "front leg": leg_area * ARM_UNDER / math.cos(math.radians(FRONT_LEAN)),
        "rear leg": leg_area * rear_leg_length(),
        "side rail": RAIL_T * (SEAT_Y[1] - SEAT_Y[0]) * RAIL_H,
        "armrest": ARM_W * (ARM_Y[1] - ARM_Y[0]) * (ARM_TOP - ARM_UNDER),
        "front rail": 2 * xr * RAIL_T * RAIL_H,
        "rear rail": 2 * xr * REAR_RAIL_T * RAIL_H,
        "seat cane": 2 * xr * (SEAT_Y[1] - REAR_RAIL_T - SEAT_Y[0] - RAIL_T) * CANE,
        "back post": POST[0] * POST[1] * (ARM_UNDER - SEAT_TOP) / math.cos(math.radians(BACK_TILT)),
        "back rail": 2 * xr * POST[1] * (BACK_RAILS[0][1] - BACK_RAILS[0][0]),
        "back cane": 2 * xr * CANE * (BACK_RAILS[1][0] - BACK_RAILS[0][1]),
    }
    joinery = {
        "front leg": -tenon,
        "rear leg": -tenon,
        "side rail": 2 * tenon - 2 * tenon,
        "front rail": 2 * tenon,
        "rear rail": 2 * tenon,
        "back post": -2 * back_tenon,
        "back rail": 2 * back_tenon,
    }
    for part in parts:
        want = plain[part.name] + joinery.get(part.name, 0)
        assert part.is_valid() and abs(part.volume - want) < 1e-6 * want, (part.name, part.volume, want)
    whole = parts[0]
    for part in parts[1:]:
        whole += part
    want = sum(plain[p.name] for p in parts)  # tenons fill their mortises, nothing else overlaps or gapes
    assert abs(whole.volume - want) < 1e-6 * want, (whole.volume, want)
    by_name = {}
    for part in parts:
        by_name.setdefault(part.name, []).append(part)
    for a, b in (
        ("armrest", "front leg"),
        ("armrest", "back post"),
        ("rear leg", "front leg"),
        ("seat cane", "front rail"),
        ("back cane", "back rail"),
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
