# Faces with mixed normal directions: does stitch unify them? Cube from six ruled faces.
import itertools
P = lambda x, y, z: (10 * x, 10 * y, 10 * z)
def quad(a, b, c, d, flip):
    # ruled between edge a-b and edge d-c; flip swaps the two curves (opposite normal)
    e1, e2 = Line(P(*a), P(*b)), Line(P(*d), P(*c))
    return ruled(e2, e1) if flip else ruled(e1, e2)
faces_def = [((0,0,0),(1,0,0),(1,1,0),(0,1,0)), ((0,0,1),(1,0,1),(1,1,1),(0,1,1)),
             ((0,0,0),(1,0,0),(1,0,1),(0,0,1)), ((0,1,0),(1,1,0),(1,1,1),(0,1,1)),
             ((0,0,0),(0,1,0),(0,1,1),(0,0,1)), ((1,0,0),(1,1,0),(1,1,1),(1,0,1))]
for flips in [(0,0,0,0,0,0), (1,0,1,0,1,0), (0,1,0,1,0,1), (1,1,1,1,1,1), (1,0,0,0,0,0)]:
    sheets = [quad(*fd, fl) for fd, fl in zip(faces_def, flips)]
    outward = [round(s.faces()[0].normal_at().dot(s.faces()[0].center() - Vector(5, 5, 5)) / 5) for s in sheets]
    r = stitch(sheets)
    if isinstance(r, Part):
        normals_out = [round(f.normal_at().dot(f.center() - Vector(5, 5, 5)) / 5) for f in r.faces()]
        print(f"[07] flips {flips} input outward {outward}: Part vol {r.volume:.3f} valid {r.is_valid()} result outward {normals_out}")
    else:
        print(f"[07] flips {flips}: Shell")
