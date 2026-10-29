# Examples

Each example is a script in [`examples/`](https://github.com/awv-informatik/smlibpy/tree/main/examples) with a `model()` function. Run one to open the model in the viewer and write a STEP file:

```bash
python examples/flange.py
```

## Bracket

Mounting bracket: an L-profile extruded, with a rounded inner corner and holes in both flanges.

![bracket](images/bracket.png)

```py
from smlibpy import *


def model() -> Part:
    t = 8  # wall thickness
    profile = Polygon((0, 0), (60, 0), (60, t), (t, t), (t, 50), (0, 50))
    bracket = profile.on(Plane.front).extrude(-40)  # front plane faces -Y; extrude backwards

    bracket = bracket.fillet(bracket.edges().concave(), 6)
    vertical = bracket.edges().parallel_to(Z)
    bracket = bracket.fillet(vertical.min_by(X) + vertical.max_by(X), 4)  # round both ends

    base = bracket.faces().facing(Z).bottom()  # the base flange's top face at z = t
    upright = bracket.faces().facing(-X).one()
    bracket -= (GridLocations(24, 20, 1, 2) * Pos(8) * Hole(3.2, t)).on(base)
    bracket -= (GridLocations(20, 1, 2, 1) * Pos(0, 8) * CounterSinkHole(3.2, 6, t)).on(upright)
    return bracket.named("bracket").colored("#7c93b5")
```

## Flange

Pipe flange: a revolved cross-section with a bolt circle.

![flange](images/flange.png)

```py
from smlibpy import *


def model() -> Part:
    # half cross-section in the front plane (x = radius, y = height), revolved about Z
    section = Polygon((25, 0), (60, 0), (60, 12), (35, 12), (35, 40), (25, 40))
    flange = section.on(Plane.front).revolve(Z)

    flange -= PolarLocations(47.5, 8) * Cylinder(5, 30)
    flange = flange.fillet(flange.edges().concave(), 4)          # neck to plate
    flange = flange.chamfer(flange.faces().top().edges().circles(), 1)
    return flange.named("flange").colored("#b08e6c")
```

## Enclosure

Electronics enclosure: rounded box, shelled, with screw bosses and a matching lid.

![enclosure](images/enclosure.png)

```py
from smlibpy import *

C, MIN = Align.CENTER, Align.MIN


def model() -> ShapeList:
    w, d, h, wall = 100, 64, 32, 2
    box = RoundedRectangle(w, d, 8).extrude(h)
    box = box.fillet(box.faces().bottom().edges(), 4)
    box = box.shell(wall, box.faces().top())

    boss = Cylinder(4, h - wall, align=(C, C, MIN)) - Cylinder(1.4, h, align=(C, C, MIN))
    box += (GridLocations(w - 16, d - 16, 2, 2) * boss).translate(0, 0, wall)

    lid = RoundedRectangle(w, d, 8).extrude(wall)
    lip = RoundedRectangle(w - 2 * wall - 0.4, d - 2 * wall - 0.4, 6).extrude(-3)
    lid = (lid + lip) - GridLocations(w - 16, d - 16, 2, 2) * Cylinder(1.7, 20)
    lid = lid.translate(0, 0, h + 15)
    return ShapeList([box.named("box").colored("#5b6b7f"), lid.named("lid").colored("#d9925a")])
```

## Pipe

A bent pipe: a ring profile swept along a path of lines and arcs, with flanges at the ends.

![pipe](images/pipe.png)

```py
from smlibpy import *


def model() -> Part:
    r = 30  # bend radius
    path = Wire([
        Line((0, 0, 0), (0, 0, 60)),
        CenterArc((r, 60), r, 180, -90, plane=Plane.front),
        Line((r, 0, 60 + r), (r + 80, 0, 60 + r)),
    ])
    pipe = sweep(Circle(10) - Circle(8), path)

    flange = (Circle(20) - Circle(8) - PolarLocations(15, 4) * Circle(2)).extrude(4)
    start = flange.translate(0, 0, -4)
    end = flange.on(Plane((r + 80, 0, 60 + r), z_dir=(1, 0, 0)))
    return (pipe + start + end).named("pipe").colored("#79ad73")
```

## Spring

Compression spring: a circle swept along a helix, with ground ends.

![spring](images/spring.png)

```py
from smlibpy import *


def model() -> Part:
    coil = sweep(Circle(1.2), Helix(pitch=6, height=48, radius=10))
    coil = coil.split(Plane.XY.offset(1.2)).split(Plane.XY.offset(48 - 1.2), keep="below")
    return coil.named("spring").colored("#9d87c7")
```

## Bottle

The classic OpenCASCADE bottle, built with smlibpy.

![bottle](images/bottle.png)

```py
from smlibpy import *


def model() -> Part:
    width, thickness, height = 50.0, 30.0, 70.0

    # half of the base outline: a straight flank, an arc, another flank
    half = Wire([
        Line((-width / 2, 0), (-width / 2, -thickness / 4)),
        ThreePointArc((-width / 2, -thickness / 4), (0, -thickness / 2), (width / 2, -thickness / 4)),
        Line((width / 2, -thickness / 4), (width / 2, 0)),
    ])
    outline = half + half.mirror(Plane.XZ)

    body = make_face(outline).extrude(height)
    body = body.fillet(body.edges(), thickness / 12)

    neck = Cylinder(thickness / 4, height / 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, height)
    bottle = body + neck
    bottle = bottle.shell(thickness / 50, bottle.faces().top())
    return bottle.named("bottle").colored("#6bb3b3")
```

## Gear

Involute spur gear with a bore and a keyway.

![gear](images/gear.png)

```py
import math

from smlibpy import *


def involute_tooth(module: float, teeth: int, pressure_angle: float = 20.0) -> Sketch:
    rp = module * teeth / 2                       # pitch radius
    rb = rp * math.cos(math.radians(pressure_angle))  # base radius
    ra = rp + module                               # tip radius
    rr = rp - 1.25 * module                        # root radius

    def involute(r: float) -> tuple[float, float]:
        t = math.sqrt(max((r / rb) ** 2 - 1, 0.0))
        return rb * (math.cos(t) + t * math.sin(t)), rb * (math.sin(t) - t * math.cos(t))

    # half tooth thickness at the pitch circle is a quarter of the circular pitch
    inv = lambda a: math.tan(a) - a  # noqa: E731
    half_angle = math.pi / (2 * teeth) + inv(math.radians(pressure_angle))
    start = max(rb, rr)
    pts = [involute(start + (ra - start) * i / 12) for i in range(13)]
    rot = lambda p, a: (p[0] * math.cos(a) - p[1] * math.sin(a), p[0] * math.sin(a) + p[1] * math.cos(a))  # noqa: E731
    right = [rot(p, -half_angle) for p in pts]
    left = [(x, -y) for x, y in reversed(right)]

    flank_r = Spline(*right)
    flank_l = Spline(*left)
    tip = ThreePointArc(right[-1], (ra, 0), left[0])
    root_r, root_l = (rr * 0.98, right[0][1] * rr / right[0][0]), (rr * 0.98, left[-1][1] * rr / left[-1][0])
    outline = Wire([Line(root_r, right[0]), flank_r, tip, flank_l, Line(left[-1], root_l), Line(root_l, root_r)])
    return make_face(outline)


def model(module: float = 2.0, teeth: int = 24, width: float = 12.0, bore: float = 10.0) -> Part:
    rr = module * teeth / 2 - 1.25 * module
    tooth = involute_tooth(module, teeth)
    profile = Circle(rr) + PolarLocations(0, teeth) * tooth
    profile = profile - Circle(bore / 2) - Rectangle(3, 3).translate(bore / 2, 0)
    gear = profile.extrude(width)
    gear = gear.chamfer(gear.edges().circles().filter(lambda e: e.radius > bore), 0.5)
    return gear.named("gear").colored("#d4b45a")
```

## Compass_armchair

Cane armchair on compass legs: teak, the rear legs butting against the front, the seat tenoned in, a tilted back.

![compass_armchair](images/compass_armchair.png)

```py
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
```
