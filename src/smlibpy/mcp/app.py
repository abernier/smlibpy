"""Buerligons, the ClassCAD app, as the viewer of an MCP session.

Its build for MCP sessions (the app that finds its session at ``/session`` on the address it was
loaded from) comes in the npm package ``@buerli.io/buerligons`` (``dist/mcp/``). It is downloaded
the first time a session needs it, checked against the hash pinned here and kept in the user's
cache; ``SMLIBPY_APP_DIR`` points to a folder with the app instead (an ``index.html`` and its
``assets``).
"""

from __future__ import annotations

import base64
import hashlib
import io
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

PACKAGE = "@buerli.io/buerligons"
VERSION = "2.0.0-beta.20261016112850"
INTEGRITY = "sha512-z+WJAEo8xUrMMS7D4RevNDVl7Cs9/LVVYLINuu0j6G/tw7CCXzWGOQKW1Rrx8DfT3iGiK7t+OUtM9PfNahDBbw=="
TARBALL = f"https://registry.npmjs.org/{PACKAGE}/-/buerligons-{VERSION}.tgz"
FOLDER = "package/dist/mcp/"  # the app inside the tarball (dist/site is the one for buerligons.io)
DONE = ".complete"  # written last: a folder without it is not used


class AppUnavailable(Exception):
    pass


def cache_root() -> Path:
    """The user's cache folder for smlibpy."""
    if os.environ.get("SMLIBPY_CACHE"):
        return Path(os.environ["SMLIBPY_CACHE"])
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "smlibpy"
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "smlibpy" / "Cache"
    return Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "smlibpy"


def app_dir(url: str = TARBALL, integrity: str = INTEGRITY, version: str = VERSION) -> Path:
    """The folder with the app, downloaded first if it is not in the cache yet."""
    if os.environ.get("SMLIBPY_APP_DIR"):
        folder = Path(os.environ["SMLIBPY_APP_DIR"])
        if not (folder / "index.html").is_file():
            raise AppUnavailable(f"SMLIBPY_APP_DIR={folder} has no index.html")
        return folder
    folder = cache_root() / "buerligons" / version
    if (folder / DONE).is_file():
        return folder
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
    except OSError as e:
        raise AppUnavailable(f"the app could not be downloaded from {url}: {e}") from None
    algorithm, _, expected = integrity.partition("-")
    if base64.b64encode(hashlib.new(algorithm, data).digest()).decode() != expected:
        raise AppUnavailable(f"the download from {url} does not match its pinned hash; it is not used")
    _extract(data, folder, version)
    return folder


def _extract(tarball: bytes, folder: Path, version: str) -> None:
    """The app's files (regular files under FOLDER, nothing else) into ``folder``, which appears
    complete or not at all."""
    folder.parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=".partial-", dir=folder.parent))
    try:
        with tarfile.open(fileobj=io.BytesIO(tarball), mode="r:gz") as tar:
            for member in tar.getmembers():
                if not member.isfile() or not member.name.startswith(FOLDER):
                    continue
                rel = Path(member.name[len(FOLDER):])
                if rel.is_absolute() or ".." in rel.parts or not rel.parts:
                    continue
                target = work / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                source = tar.extractfile(member)
                assert source is not None
                target.write_bytes(source.read())
        if not (work / "index.html").is_file():
            raise AppUnavailable("the package holds no app (no index.html)")
        (work / DONE).write_text(version)
        shutil.rmtree(folder, ignore_errors=True)
        work.rename(folder)
    finally:
        shutil.rmtree(work, ignore_errors=True)
