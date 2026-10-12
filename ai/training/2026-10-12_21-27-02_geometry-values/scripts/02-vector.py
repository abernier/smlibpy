# Vector: construction, arithmetic, algebra
print("[02] Vector():", Vector())
print("[02] Vector(1,2):", Vector(1, 2))
print("[02] Vector(1,2,3):", Vector(1, 2, 3))
print("[02] Vector((1,2,3)):", Vector((1, 2, 3)), "Vector([1,2]):", Vector([1, 2]))
print("[02] Vector(np):", Vector(np.array([1.0, 2.0, 3.0])))
v = Vector(1, 2, 3)
print("[02] copy is same?:", Vector(v) is v, Vector(v) == v)
for bad in [(1,), (1, 2, 3, 4)]:
    try:
        Vector(bad)
    except Exception as e:
        print("[02] Vector", bad, "->", type(e).__name__, e)
try:
    Vector(1, 2, 3, 4)
except Exception as e:
    print("[02] Vector(1,2,3,4) ->", type(e).__name__, e)
a, b = Vector(1, 0, 0), Vector(0, 1, 0)
print("[02] a+b:", a + b, "a+(0,0,1):", a + (0, 0, 1), "(0,0,1)+a:", (0, 0, 1) + a)
print("[02] a-b:", a - b, "(5,5,5)-a:", (5, 5, 5) - a)
print("[02] a*3:", a * 3, "3*a:", 3 * a, "a/2:", a / 2, "-a:", -a)
try:
    a * b
except Exception as e:
    print("[02] a*b ->", type(e).__name__, e)
print("[02] abs:", abs(Vector(3, 4, 0)), "length:", Vector(3, 4, 0).length)
print("[02] dot:", a.dot(b), Vector(1, 2, 3).dot((4, 5, 6)))
print("[02] cross a x b:", a.cross(b), "b x a:", b.cross(a))
print("[02] normalized:", Vector(3, 4, 0).normalized())
try:
    Vector().normalized()
except Exception as e:
    print("[02] zero normalized ->", type(e).__name__, e)
print("[02] angle_to:", a.angle_to(b), a.angle_to(-a), a.angle_to((1, 1, 0)), "signed?", b.angle_to(a))
print("[02] distance_to:", a.distance_to(b))
print("[02] to_tuple:", v.to_tuple(), "x,y,z:", v.x, v.y, v.z, "v[2]:", v[2], "list:", list(v), "len", len(v))
x, y, z = v
print("[02] unpack:", x, y, z)
print("[02] np.array:", np.array(v))
print("[02] is_close:", Vector(1, 0, 0).is_close((1 + 1e-7, 0, 0)), Vector(1, 0, 0).is_close((1 + 1e-5, 0, 0)))
print("[02] eq tol:", Vector(1, 0, 0) == (1 + 5e-7, 0, 0), Vector(1, 0, 0) == (1 + 2e-6, 0, 0))
print("[02] eq tuple 2d:", Vector(1, 2) == (1, 2))
print("[02] is_parallel:", a.is_parallel(-a), a.is_parallel(b), "perp:", a.is_perpendicular(b))
print("[02] rotate about Z 90:", a.rotate(Z, 90), "about (0,0,1):", a.rotate((0, 0, 1), 90))
print("[02] rotate about axis thru (1,1,0):", Vector(2, 1, 0).rotate(Axis((1, 1, 0), (0, 0, 1)), 90))
print("[02] project_to XY.offset(5):", Vector(3, 4, 9).project_to(Plane.XY.offset(5)))
print("[02] any_perpendicular of Z:", Vector(0, 0, 1).any_perpendicular(), "of X:", Vector(1, 0, 0).any_perpendicular())
try:
    v.x = 5
except Exception as e:
    print("[02] immutable ->", type(e).__name__, e)
print("[02] hash eq:", hash(Vector(1, 2, 3)) == hash(Vector(1, 2, 3)), len({Vector(1, 2, 3), Vector(1, 2, 3)}))
print("[02] X is Axis:", type(X).__name__, "X.direction:", X.direction)
print("[02] Vector + X?")
try:
    print(Vector(1, 2, 3) + X)
except Exception as e:
    print("[02] Vector+Axis ->", type(e).__name__, e)
print("[02] Vector(X.direction)*5:", X.direction * 5)
p = Box(10, 10, 10).translate(Vector(1, 2, 3))
print("[02] translate by Vector:", p.bbox().center)
print("[02] sum of vectors:", sum([Vector(1, 0, 0), Vector(0, 1, 0)], Vector()))
try:
    print("[02] sum without start:", sum([Vector(1, 0, 0), Vector(0, 1, 0)]))
except Exception as e:
    print("[02] sum without start ->", type(e).__name__, e)
print("[02] Vector('1','2','3'):", end=" ")
try:
    print(Vector("1", "2", "3"))
except Exception as e:
    print(type(e).__name__, e)
