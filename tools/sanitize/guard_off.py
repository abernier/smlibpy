"""pytest plugin of the sanitizer run (tools/sanitize/run.py): every kernel step in the test
process (``smlibpy.defeature.GUARD_SECONDS = 0``), where AddressSanitizer sees it; in a forked
copy, its first report would end only the copy. Left out: the tests that measure the process's
memory (the sanitizer keeps freed memory in quarantine, and its own bookkeeping grows), those that
reach a known memory error of the kernel (tools/sanitize/known.txt), and those that cannot pass
with the guard off or with the sanitizer's module."""

import pytest

#: Tests that measure memory (the sanitizer's leak check covers what they look for).
MEASURE_MEMORY = ("test_failed_booleans_free_their_operands", "test_seam_checks_on_import_free_their_curves",
                  "test_sweeps_free_the_curves_they_hand_the_kernel", "test_compact_gives_the_memory_back",
                  "test_booleans_that_turn_a_seam_free_their_copies", "test_failed_sliver_removals_free_their_copies",
                  "test_failed_booleans_free_the_kernel_s_intersections")
#: Tests that reach a known memory error of the kernel (tools/sanitize/known.txt): the extended
#: offset's sm_FixProblemsBySqueezing.
KNOWN_ERRORS = ("test_offsets_that_read_freed_kernel_memory_fail",)
#: Tests that cannot pass here: they check the guard's own settings, which this run sets; or they
#: start Python processes of their own, which cannot load the sanitizer's module.
NOT_HERE = ("test_the_guard_settings_are_checked",)
LEFT_OUT = MEASURE_MEMORY + KNOWN_ERRORS + NOT_HERE


def pytest_configure(config):  # noqa: ARG001 - pytest's hook
    import smlibpy.defeature

    smlibpy.defeature.GUARD_SECONDS = 0


def pytest_collection_modifyitems(config, items):
    left, out = [], []
    for item in items:
        (out if item.originalname in LEFT_OUT else left).append(item)
    if out:
        config.hook.pytest_deselected(items=out)
        items[:] = left


def pytest_unconfigure(config):  # noqa: ARG001 - pytest's hook
    # (what the tests left in reference cycles is freed now, by its handles, not dropped by the
    # interpreter's shutdown, which would count as leaked)
    import gc

    gc.collect()
