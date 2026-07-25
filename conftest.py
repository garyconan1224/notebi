"""Keep the complete pytest process away from the user's real data directory."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path


_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="notebi-pytest-data-"))
os.environ["NOTEBI_DATA_DIR"] = str(_TEST_DATA_DIR)


def pytest_sessionfinish() -> None:
    shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)
