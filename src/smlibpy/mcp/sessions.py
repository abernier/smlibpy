"""Sessions: one connection, many conversations.

A host may send many conversations through ONE connection: the Claude desktop chat app and
Cowork start one process per configured server and pass every conversation's tool calls through
it, and nothing in a request says which conversation it comes from. One session per process is
then one session for all of them: one conversation's clear or restore, or a variable of the same
name, is another one's lost model.

So the session is named in the call itself. Every tool that works on a model takes ``session``:
"new" opens one and the answer names its id, and the conversation passes that id from then on.
Each one is a Session of its own (its worker, scripts and checkpoints) with a live view of its own.
The ids are random and only the conversation that opened a session is told its id, so no other one
reaches it. A call without a session, or with one this server does not know, changes nothing.

Idle sessions sleep: one nobody used for SMLIBPY_SESSION_IDLE_S seconds gives its worker up and
keeps its scripts, and at most SMLIBPY_SESSIONS_AWAKE stay awake (the least recently used one
sleeps first). The next call runs the scripts again in a new worker (session.py).
"""

from __future__ import annotations

import os
import secrets
import threading
import time
from dataclasses import dataclass

from .buerli import BuerliHost
from .session import Session

NEW = "new"
IDLE_S = float(os.environ.get("SMLIBPY_SESSION_IDLE_S") or 1800)
AWAKE_MAX = int(os.environ.get("SMLIBPY_SESSIONS_AWAKE") or 8)
_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"

PARAM = ('The session this call works on. "new" opens a new, empty session, and the answer names its id; '
         'from then on pass that id (e.g. "s-k3v9q2xa") in every call of this conversation about that model. '
         'A session belongs to the conversation that opened it: no other conversation can see or change it.')

NOTE = ('SESSIONS: every tool that works on a model takes `session`. The first call of a model passes "new"; '
        'its answer names the session\'s id ("s-..."). Pass that id in every further call of this conversation '
        'about that model: run_script, snapshot, save, view and all the others. A session holds its own '
        'variables, scripts, checkpoints and live view, and belongs to the conversation that opened it: no '
        'other conversation reaches it, and none can reach yours. A second, unrelated model is a second session '
        '("new" again). A subagent works on your model only with its id: hand it over in the task. Sessions '
        'live as long as this server; save what is to be kept.')


class SessionError(Exception):
    """The call names no session this server has: nothing was done."""


def opened_note(session_id: str) -> str:
    return (f'Session "{session_id}" is new and belongs to this conversation. Pass session: "{session_id}" in every '
            'further call about this model; "new" again only for another, separate model (it starts empty).')


@dataclass
class Slot:
    """One conversation's session and its live view."""

    id: str
    session: Session
    viewer: BuerliHost


class Sessions:
    """The sessions of one server process."""

    def __init__(self) -> None:
        self._slots: dict[str, Slot] = {}
        self._lock = threading.Lock()
        self._closed = threading.Event()
        threading.Thread(target=self._sweep, name="smlibpy-sessions", daemon=True).start()

    def __len__(self) -> int:
        return len(self._slots)

    def resolve(self, named: str | None, tool: str) -> tuple[Slot, bool]:
        """The slot a call names, and whether this call opened it."""
        if not isinstance(named, str) or not named.strip():
            raise SessionError(f'{tool} works on a session: pass session="<id>" with the id an earlier answer of '
                               'this conversation named, or "new" for a new, empty one. Nothing was done.')
        key = named.strip()
        if key.lower() == NEW:
            return self.open(), True
        with self._lock:
            found = self._slots.get(key)
        if found is None:
            raise SessionError(f'No session "{key}" here; nothing was done. Pass the id an earlier answer of this '
                               'conversation named. Sessions end with the server (the app restarted, or the server '
                               'did), and one opened in another conversation is out of reach. "new" opens a new, '
                               'empty session.')
        return found, False

    def open(self) -> Slot:
        session = Session()
        with self._lock:
            slot = Slot(self._new_id(), session, BuerliHost(session))
            self._slots[slot.id] = slot
        return slot

    def _new_id(self) -> str:
        while True:
            session_id = "s-" + "".join(_ALPHABET[b & 31] for b in secrets.token_bytes(8))
            if session_id not in self._slots:
                return session_id

    @property
    def awake(self) -> int:
        with self._lock:
            return sum(1 for slot in self._slots.values() if slot.session.awake)

    def settle(self) -> None:
        """Too many awake: the least recently used ones sleep (a busy one is left alone)."""
        with self._lock:
            awake = sorted((s for s in self._slots.values() if s.session.awake), key=lambda s: s.session.last_use)
        for slot in awake[: max(0, len(awake) - AWAKE_MAX)]:
            slot.session.sleep()

    def _sweep(self) -> None:
        while not self._closed.wait(min(60.0, max(1.0, IDLE_S / 4))):
            now = time.monotonic()
            with self._lock:
                idle = [s for s in self._slots.values() if s.session.awake and now - s.session.last_use > IDLE_S]
            for slot in idle:
                slot.session.sleep()

    def close(self) -> None:
        self._closed.set()
        with self._lock:
            slots, self._slots = list(self._slots.values()), {}
        for slot in slots:
            slot.viewer.close()
            slot.session.close()
