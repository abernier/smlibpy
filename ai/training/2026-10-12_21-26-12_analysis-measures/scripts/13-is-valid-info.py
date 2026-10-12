# What is_valid() reports for good, touching, self-intersecting and odd bodies; what info() holds.
pi = math.pi
def show(name, p):
    try:
        v = p.is_valid()
    except Exception as e:
        v = f"{type(e).__name__}: {e}"
    try:
        vol = round(p.volume, 6)
    except Exception as e:
        vol = f"{type(e).__name__}: {e}"
    n = len(p.solids()) if isinstance(p, Part) else "-"
    print(f"[13] {name}: type={type(p).__name__} is_valid={v} volume={vol} solids={n} info={p.info()}")
    return p

show("box", Box(10, 20, 30))
show("cylinder", Cylinder(5, 10))
show("two disjoint boxes", Box(10, 10, 10) + Box(10, 10, 10).translate(20, 0, 0))
show("face-touching boxes", Box(10, 10, 10) + Box(10, 10, 10).translate(10, 0, 0))
try:
    show("edge-touching boxes", Box(10, 10, 10) + Box(10, 10, 10).translate(10, 10, 0))
except Exception as e:
    print(f"[13] edge-touching boxes: {type(e).__name__}: {e}")
try:
    show("vertex-touching boxes", Box(10, 10, 10) + Box(10, 10, 10).translate(10, 10, 10))
except Exception as e:
    print(f"[13] vertex-touching boxes: {type(e).__name__}: {e}")
# self-intersecting sweep: profile radius larger than the helix pitch allows
try:
    bad = sweep(Circle(4), Helix(5, 20, 10))
    show("self-intersecting spring (r4, pitch 5)", bad)
    snapshot("selfint", bad)
except Exception as e:
    print(f"[13] self-intersecting spring: {type(e).__name__}: {e}")
# profile crossing the revolve axis
try:
    crossing = Rectangle(10, 10).revolve(Axis((0, 0, 0), (0, 1, 0)))
    show("revolve of a profile crossing the axis", crossing)
except Exception as e:
    print(f"[13] revolve crossing axis: {type(e).__name__}: {e}")
show("open shell (top face)", Box(10, 10, 10).faces().top().one().to_shell())
show("sketch", Circle(5))
