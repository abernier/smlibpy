"""Keyword parameters that were renamed: the old name still works, with a DeprecationWarning.

The signature (and so the docs, the MCP and smlibwasm's options table) shows the new names only.
"""

from __future__ import annotations

import functools
import warnings
from typing import Any, Callable, TypeVar

F = TypeVar("F", bound=Callable[..., Any])


def renamed(since: str, **names: str | tuple[str, Callable[[Any], Any]]) -> Callable[[F], F]:
    """Accept the old keyword names of a function: ``@renamed("0.5.1", tol="tolerance")``. An old
    name whose values changed too maps to ``(new name, converter)``; an old value of None is dropped."""

    def wrap(fn: F) -> F:
        @functools.wraps(fn)
        def call(*args: Any, **kwargs: Any) -> Any:
            if kwargs and not names.keys().isdisjoint(kwargs):
                for old, new in names.items():
                    if old not in kwargs:
                        continue
                    value = kwargs.pop(old)
                    name, convert = (new, None) if isinstance(new, str) else new
                    if name in kwargs:
                        raise TypeError(f"{fn.__qualname__}: {old}= is {name}= since smlibpy {since}; "
                                        f"pass {name}= alone")
                    warnings.warn(f"{fn.__qualname__}: {old}= is {name}= since smlibpy {since}; {old}= will be removed",
                                  DeprecationWarning, stacklevel=2)
                    if value is not None:
                        kwargs[name] = convert(value) if convert else value
            return fn(*args, **kwargs)

        return call  # type: ignore[return-value]

    return wrap
