# Inertia tensor about the center of mass against formulas; density; rotated and far bodies.
pi = math.pi
rho = 7.85e-3  # steel, g/mm^3
def check(name, p, Iexp, vexp):
    mp = p.mass_properties(density=rho)
    m = rho * vexp
    I = mp.inertia
    rel = np.abs(I - np.array(Iexp)) / np.abs(np.array(Iexp)).max()
    print(f"[05] {name}: mass={mp.mass:.8g} exp={m:.8g} relm={(mp.mass-m)/m:+.2e} maxrelI={rel.max():.2e} density={mp.density}")
    return mp

a, b, c = 40.0, 30.0, 20.0
m = rho*a*b*c
check("box", Box(a, b, c), np.diag([m*(b*b+c*c)/12, m*(a*a+c*c)/12, m*(a*a+b*b)/12]), a*b*c)
r, h = 6.0, 20.0; v = pi*r*r*h; m = rho*v
check("cylinder", Cylinder(r, h), np.diag([m*(3*r*r+h*h)/12, m*(3*r*r+h*h)/12, m*r*r/2]), v)
r = 10.0; v = 4/3*pi*r**3; m = rho*v
check("sphere", Sphere(r), np.diag([0.4*m*r*r]*3), v)
R, r = 20.0, 5.0; v = 2*pi**2*R*r*r; m = rho*v
check("torus", Torus(R, r), np.diag([m*(R*R/2+5/8*r*r), m*(R*R/2+5/8*r*r), m*(R*R+0.75*r*r)]), v)
r, h = 10.0, 30.0; v = pi*r*r*h/3; m = rho*v
check("cone", Cone(r, 0, h), np.diag([m*(3/20*r*r+3/80*h*h), m*(3/20*r*r+3/80*h*h), 0.3*m*r*r]), v)

# rotated box: I' = R I R^T; far box: unchanged
m = rho*a*b*c
I0 = np.diag([m*(b*b+c*c)/12, m*(a*a+c*c)/12, m*(a*a+b*b)/12])
ax = Axis((0, 0, 0), (1, 2, 3))
Rm = Location.about(ax, 37).matrix[:3, :3]
mp = check("box rot (1,2,3) 37", Box(a, b, c).rotate(ax, 37), Rm @ I0 @ Rm.T, a*b*c)
print("[05] rotated inertia:", np.round(mp.inertia, 3).tolist())
print("[05] principal moments:", [round(x, 4) for x in mp.principal_moments], "expected sorted:", sorted(np.round(np.diag(I0), 4)))
for v_, e in zip(mp.principal_axes, [Rm[:, 2], Rm[:, 1], Rm[:, 0]]):
    print("[05] principal axis:", v_, " |dot| with rotated world axis:", round(abs(np.dot(np.array(v_.to_tuple()), e)), 9))
mp = check("box far 1e5", Box(a, b, c).translate(1e5, 2e5, -3e5), I0, a*b*c)
print("[05] far center:", mp.center)
mp = check("box at 0,0,50 (not about origin)", Box(a, b, c).translate(0, 0, 50), I0, a*b*c)

# off-diagonal sign convention: L-shape of two boxes in the XY plane
L = Box(20, 10, 10, align=Align.MIN) + Box(10, 20, 10, align=Align.MIN)
mp = L.mass_properties()
pts = np.array([[x+0.5, y+0.5] for x in range(20) for y in range(20) if (y < 10) or (x < 10)])
cx, cy = pts.mean(0)
pxy = sum((x-cx)*(y-cy) for x, y in pts) * 10  # unit cells * depth 10
print("[05] L inertia:", np.round(mp.inertia, 4).tolist())
print(f"[05] L product of inertia sum((x-cx)(y-cy))dV = {pxy:.4f}; tensor[0][1] = {mp.inertia[0][1]:.4f}")
print("[05] repr:", repr(mp))
for d in (0.0, -1.0):
    try:
        mp = Box(10, 10, 10).mass_properties(density=d)
        print(f"[05] density={d}: mass={mp.mass} volume={mp.volume} center={mp.center}")
    except Exception as e:
        print(f"[05] density={d}: {type(e).__name__}: {e}")
