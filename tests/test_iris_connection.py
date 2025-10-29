#!/usr/bin/env python3
"""Manual IRIS connection test placeholder (skipped in CI)."""

import pytest

pytestmark = pytest.mark.skip(
    reason="Manual integration test; run separately when verifying IRIS endpoint."
)
