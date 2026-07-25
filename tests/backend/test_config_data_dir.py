from __future__ import annotations

import os
from pathlib import Path

from shared.config import DATA_DIR


def test_pytest_data_root_comes_from_environment() -> None:
    assert DATA_DIR == Path(os.environ["NOTEBI_DATA_DIR"]).resolve()
