"""Generate docs/examples.md from the scripts in examples/ (run after changing an example)."""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
ORDER = ["bracket", "flange", "enclosure", "pipe", "spring", "bottle", "gear", "compass_armchair"]


def main() -> None:
    parts = [
        "# Examples\n",
        "Each example is a script in [`examples/`](https://github.com/awv-informatik/smlibpy/tree/main/examples) "
        "with a `model()` function. Run one to open the model in the viewer and write a STEP file:\n",
        "```bash\npython examples/flange.py\n```\n",
    ]
    for name in ORDER:
        src = (ROOT / "examples" / f"{name}.py").read_text()
        doc = re.match(r'"""(.*?)"""', src, re.S).group(1).strip()
        body = src[src.index('"""', 3) + 3:]
        body = body[:body.index('if __name__ == "__main__":')].strip()
        parts.append(f"## {name.capitalize()}\n\n{doc}\n\n![{name}](images/{name}.png)\n\n```py\n{body}\n```\n")
    (ROOT / "docs" / "examples.md").write_text("\n".join(parts))


if __name__ == "__main__":
    main()
