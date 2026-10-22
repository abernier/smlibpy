"""pytest plugin of the sanitizer run (tools/sanitize/run.py): every kernel step in the test
process (``smlibpy.defeature.GUARD_SECONDS = 0``), where AddressSanitizer sees it; in a forked
copy, its first report would end only the copy. The tests that measure the process's memory are
left out: the sanitizer keeps freed memory in quarantine, and its own bookkeeping grows."""

import pytest

#: Tests that measure memory (the sanitizer's leak check covers what they look for).
MEASURE_MEMORY = ("test_failed_booleans_free_their_operands", "test_seam_checks_on_import_free_their_curves",
                  "test_sweeps_free_the_curves_they_hand_the_kernel")


def pytest_configure(config):  # noqa: ARG001 - pytest's hook
    import smlibpy.defeature

    smlibpy.defeature.GUARD_SECONDS = 0


def pytest_collection_modifyitems(config, items):
    left, out = [], []
    for item in items:
        (out if item.originalname in MEASURE_MEMORY else left).append(item)
    if out:
        config.hook.pytest_deselected(items=out)
        items[:] = left


def pytest_unconfigure(config):  # noqa: ARG001 - pytest's hook
    # (what the tests left in reference cycles is freed now, by its handles, not dropped by the
    # interpreter's shutdown, which would count as leaked)
    import gc

    gc.collect()
