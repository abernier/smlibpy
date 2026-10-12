# helpers to write small DXF files by hand (imported by the scripts of this session)
import os, tempfile
TMP = tempfile.mkdtemp(prefix="dxf-training-")

def dxf(name, entities, header="", blocks=""):
    text = ""
    if header:
        text += "0\nSECTION\n2\nHEADER\n" + header + "0\nENDSEC\n"
    if blocks:
        text += "0\nSECTION\n2\nBLOCKS\n" + blocks + "0\nENDSEC\n"
    text += "0\nSECTION\n2\nENTITIES\n" + entities + "0\nENDSEC\n0\nEOF\n"
    path = os.path.join(TMP, name)
    with open(path, "w") as fh:
        fh.write(text)
    return path

def lw(points, closed=True, layer="0"):
    s = f"0\nLWPOLYLINE\n8\n{layer}\n90\n{len(points)}\n70\n{1 if closed else 0}\n"
    for p in points:
        s += f"10\n{p[0]}\n20\n{p[1]}\n" + (f"42\n{p[2]}\n" if len(p) > 2 else "")
    return s

def line(a, b, layer="0"):
    return f"0\nLINE\n8\n{layer}\n10\n{a[0]}\n20\n{a[1]}\n30\n0\n11\n{b[0]}\n21\n{b[1]}\n31\n0\n"

def circle(c, r, layer="0"):
    return f"0\nCIRCLE\n8\n{layer}\n10\n{c[0]}\n20\n{c[1]}\n30\n0\n40\n{r}\n"

def count(path):
    lines = open(path).read().splitlines()
    out, in_ent = {}, False
    for code, value in zip(lines[0::2], lines[1::2]):
        if code.strip() == "2" and value == "ENTITIES":
            in_ent = True
        elif code.strip() == "0" and value == "ENDSEC":
            in_ent = False
        elif in_ent and code.strip() == "0":
            out[value] = out.get(value, 0) + 1
    return out
