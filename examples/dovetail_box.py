"""Dovetailed box: oak boards with through dovetails at 1:6, pins at the edges, a plywood bottom in a hidden groove."""

from smlibpy import *

L, W, H, T = 240.0, 160.0, 90.0, 12.0  # outside length, width and height; board thickness
N, SLOPE = 3, 1 / 6  # tails per corner; 1 in 6, the usual slope for hardwood
P_EDGE, P_FULL = 16.0, 8.0  # the edge pins and the pins between the tails, at the baseline
A_BASE = (H - 2 * P_EDGE - (N - 1) * P_FULL) / N  # a tail at the baseline
A_END = A_BASE + 2 * T * SLOPE  # a tail at the end of the board, wider by the slope on each side
PLY, GROOVE, DEPTH, GAP = 6.0, 6.2, 5.0, 0.5  # bottom: plywood, groove width and depth, clearance
Z_GROOVE = 6.0  # the groove's lower edge, inside the edge pin so that nothing shows outside
MID_X = Plane(origin=(L / 2, 0, 0), z_dir=(1, 0, 0))  # the box's middle planes: the far ends mirror the near ones
MID_Y = Plane(origin=(0, W / 2, 0), z_dir=(0, 1, 0))


def tails() -> Part:
    """The tails at the x = 0 end of a tail board: trapezoids on its face, through its thickness."""
    sketch = None
    for i in range(N):
        z = P_EDGE + A_BASE / 2 + i * (A_BASE + P_FULL)
        tail = Polygon((0, z - A_END / 2), (T, z - A_BASE / 2), (T, z + A_BASE / 2), (0, z + A_END / 2))
        sketch = tail if sketch is None else sketch + tail
    return sketch.on(Plane.front).extrude(-T)  # front faces -Y; extrude backwards, y from 0 to T


def tail_board() -> Part:
    """Front and back: the tails are what is left of each end once the sockets are cut."""
    board = Box(L, T, H, align=(Align.MIN, Align.MIN, Align.MIN))
    sockets = Box(T, T, H, align=(Align.MIN, Align.MIN, Align.MIN)) - tails()
    board -= [sockets, sockets.mirror(MID_X)]
    groove = Box(L, DEPTH, GROOVE, align=(Align.MIN, Align.MAX, Align.MIN)).translate(0, T, Z_GROOVE)
    return board - groove  # runs through: its ends sit in the sockets, under the pins


def pin_board() -> Part:
    """Left and right: the pins are what the tails leave of each end; the groove stops inside the joint."""
    board = Box(T, W, H, align=(Align.MIN, Align.MIN, Align.MIN))
    board -= [tails(), tails().mirror(MID_Y)]
    stop = T - DEPTH
    groove = Box(DEPTH, W - 2 * stop, GROOVE, align=(Align.MAX, Align.MIN, Align.MIN)).translate(T, stop, Z_GROOVE)
    return board - groove


def model() -> list[Part]:
    oak, birch = "#b98a4b", "#e3d3ae"
    front = tail_board().named("front").colored(oak)
    back = front.mirror(MID_Y).named("back").colored(oak)
    left = pin_board().named("left").colored(oak)
    right = left.mirror(MID_X).named("right").colored(oak)
    inset = T - DEPTH + GAP / 2
    bottom = Box(L - 2 * inset, W - 2 * inset, PLY, align=(Align.MIN, Align.MIN, Align.MIN))
    bottom = bottom.translate(inset, inset, Z_GROOVE + (GROOVE - PLY) / 2).named("bottom").colored(birch)
    return [front, back, left, right, bottom]


def check(parts: list[Part]) -> None:
    """The numbers the kernel must find, worked out by hand: tiles that leave no gap and no overlap."""
    front, back, left, right, bottom = parts
    tail = (A_BASE + A_END) / 2 * T  # the area of one tail on the face of the board
    tails_volume = N * tail * T  # what a pin board loses at one end
    sockets_volume = T * T * H - tails_volume  # what a tail board loses at one end
    groove_tail = (L - 2 * T) * DEPTH * GROOVE  # the sockets had removed the rest
    groove_pin = (W - 2 * (T - DEPTH)) * DEPTH * GROOVE
    expected = {
        "front": L * T * H - 2 * sockets_volume - groove_tail,
        "left": T * W * H - 2 * tails_volume - groove_pin,
        "bottom": (L - 2 * (T - DEPTH) - GAP) * (W - 2 * (T - DEPTH) - GAP) * PLY,
    }
    for part in parts:
        want = expected[part.name.replace("back", "front").replace("right", "left")]
        assert part.is_valid() and abs(part.volume - want) < 1e-6 * want, (part.name, part.volume, want)
    ring = (L * W - (L - 2 * T) * (W - 2 * T)) * H - 2 * groove_tail - 2 * groove_pin
    joined = front + back + left + right
    assert abs(joined.volume - ring) < 1e-6 * ring, (joined.volume, ring)  # no gap, no overlap
    assert (front & left).volume < 1e-9 and (bottom & front).volume < 1e-9  # tails fit the pins, the panel floats
    assert abs(bottom.distance_to(front) - (GROOVE - PLY) / 2) < 1e-6  # the panel has its clearance
    for part in parts:
        size = sorted(part.bbox().size, reverse=True)
        print(f"{part.name:7} {size[0]:7.1f} x {size[1]:6.1f} x {size[2]:5.1f} mm")  # the cut list
    oak = sum(p.mass_properties(density=0.72e-3).mass for p in parts[:4])
    print(f"oak {oak / 1000:.2f} kg, bottom {bottom.mass_properties(density=0.68e-3).mass / 1000:.2f} kg")


if __name__ == "__main__":
    parts = model()
    check(parts)
    export_step(parts, "dovetail_box.step", assembly=True)
    show(parts)
