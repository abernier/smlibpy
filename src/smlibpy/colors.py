"""Color parsing for exporters and the viewer."""

from __future__ import annotations

from typing import Any

__all__ = ["to_rgb", "to_hex"]

# A practical subset of the CSS named colors.
_NAMED = {
    "black": "#000000", "white": "#ffffff", "gray": "#808080", "grey": "#808080", "silver": "#c0c0c0",
    "lightgray": "#d3d3d3", "darkgray": "#a9a9a9", "dimgray": "#696969", "slategray": "#708090",
    "red": "#ff0000", "darkred": "#8b0000", "crimson": "#dc143c", "tomato": "#ff6347", "coral": "#ff7f50",
    "orange": "#ffa500", "darkorange": "#ff8c00", "gold": "#ffd700", "yellow": "#ffff00", "khaki": "#f0e68c",
    "green": "#008000", "darkgreen": "#006400", "lime": "#00ff00", "limegreen": "#32cd32", "seagreen": "#2e8b57",
    "olive": "#808000", "teal": "#008080", "cyan": "#00ffff", "turquoise": "#40e0d0", "aquamarine": "#7fffd4",
    "blue": "#0000ff", "navy": "#000080", "darkblue": "#00008b", "royalblue": "#4169e1", "steelblue": "#4682b4",
    "dodgerblue": "#1e90ff", "deepskyblue": "#00bfff", "skyblue": "#87ceeb", "lightblue": "#add8e6",
    "cornflowerblue": "#6495ed", "slateblue": "#6a5acd", "purple": "#800080", "indigo": "#4b0082",
    "violet": "#ee82ee", "orchid": "#da70d6", "magenta": "#ff00ff", "pink": "#ffc0cb", "hotpink": "#ff69b4",
    "brown": "#a52a2a", "chocolate": "#d2691e", "sienna": "#a0522d", "peru": "#cd853f", "tan": "#d2b48c",
    "beige": "#f5f5dc", "wheat": "#f5deb3", "ivory": "#fffff0", "linen": "#faf0e6", "salmon": "#fa8072",
}


def to_rgb(color: Any) -> tuple[float, float, float]:
    """``"steelblue"``, ``"#4682b4"``, ``"#48b"``, ``(70, 130, 180)`` or ``(0.27, 0.51, 0.71)`` -> floats 0..1."""
    if isinstance(color, str):
        c = _NAMED.get(color.lower().replace(" ", ""), color)
        c = c.lstrip("#")
        if len(c) == 3:
            c = "".join(ch * 2 for ch in c)
        if len(c) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in c):
            raise ValueError(f"unknown color {color!r}")
        return (int(c[0:2], 16) / 255, int(c[2:4], 16) / 255, int(c[4:6], 16) / 255)
    r, g, b = (float(x) for x in list(color)[:3])
    if max(r, g, b) > 1.0:
        r, g, b = r / 255, g / 255, b / 255
    return (r, g, b)


def to_hex(color: Any) -> str:
    r, g, b = to_rgb(color)
    return "#{:02x}{:02x}{:02x}".format(round(r * 255), round(g * 255), round(b * 255))
