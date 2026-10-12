import os, tempfile
# partial torus by revolving a circle
quarter_ring = Circle(4).translate(20, 0, 0).on(Plane.front).revolve(Z, 90)
print("[22] quarter torus:", quarter_ring, "valid:", quarter_ring.is_valid(), "bbox:", quarter_ring.bbox(),
      "expected vol:", round(2 * math.pi**2 * 20 * 16 / 4, 3))
# lightgreen is not a known color
try:
    export_step(Box(1, 1, 1).colored("lightgreen"), os.path.join(tempfile.mkdtemp(), "x.step"))
    print("[22] lightgreen ok")
except Exception as e:
    print("[22] lightgreen:", type(e).__name__, e)
# spherical cap 3 high
cap = Sphere(8) & Box(16, 16, 3, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 5)
print("[22] cap:", cap.bbox(), round(cap.volume, 3), "formula:", round(math.pi * 9 * (3 * 8 - 3) / 3, 3))
