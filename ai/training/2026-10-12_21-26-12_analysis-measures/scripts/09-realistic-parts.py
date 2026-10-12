# Default accuracy against a tight reference (1e-11) on realistic parts, with formulas where known.
import time
pi = math.pi
parts = {}
plate = Box(80, 60, 10)
plate = plate.fillet(plate.edges().parallel_to(Z), 8)
plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)
plate -= Rectangle(30, 20).on(plate.faces().top()).extrude(-4)
parts["plate"] = (plate, 80*60*10 - 4*(8*8 - pi*64/4)*10 - 4*pi*16*10 - 30*20*4)
box = Box(60, 40, 30)
cup = box.shell(2, openings=box.faces().top())
parts["shelled box t2"] = (cup, 60*40*30 - 56*36*28)
tube = Circle(5) - Circle(4)
bend_path = CenterArc((0, 0, 0), 50, 0, 90, Plane.XZ)
pipe = sweep(tube, bend_path)
parts["bent pipe 90deg R50 5/4"] = (pipe, pi*(25-16)*(pi/2*50))
tilted = Box(40, 40, 40) - Cylinder(8, 100).rotate(Axis((0, 0, 0), (1, 1, 0)), 35)
parts["box minus tilted cylinder"] = (tilted, None)
far = tilted.rotate(Axis((0, 0, 0), (3, -1, 2)), 71).translate(5000, -8000, 12000)
parts["same, rotated and far"] = (far, None)
for name, (p, vexp) in parts.items():
    t = time.perf_counter(); v7 = p.volume; t7 = 1000*(time.perf_counter()-t)
    t = time.perf_counter(); v11 = p.mass_properties(accuracy=1e-11).volume; t11 = 1000*(time.perf_counter()-t)
    s = f"[09] {name}: V7={v7:.12g} V11={v11:.12g} rel7={(v7-v11)/v11:+.2e} ({t7:.0f}/{t11:.0f} ms)"
    if vexp:
        s += f" formula={vexp:.12g} rel11={(v11-vexp)/vexp:+.2e}"
    print(s + f" valid={p.is_valid()}")
print(f"[09] tilted vs far V7 diff rel={(parts['same, rotated and far'][0].volume-tilted.volume)/tilted.volume:+.2e}")
snapshot("parts", plate, cup.translate(100, 0, 0), pipe.translate(0, 100, 0), tilted.translate(100, 100, 0), view="iso")
