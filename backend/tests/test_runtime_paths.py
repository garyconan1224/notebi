from pathlib import Path

from shared.runtime_paths import resolve_runtime_paths


def test_runtime_paths_keep_source_defaults_for_development(tmp_path: Path) -> None:
    paths = resolve_runtime_paths(source_root=tmp_path, environ={})

    assert paths.source_root == tmp_path
    assert paths.data_dir == tmp_path / "data"
    assert paths.state_dir == tmp_path / ".local"
    assert paths.projects_dir == tmp_path / "projects"


def test_runtime_paths_honor_desktop_sidecar_directories(tmp_path: Path) -> None:
    paths = resolve_runtime_paths(
        source_root=tmp_path / "bundle",
        environ={
            "NOTEBI_DATA_DIR": str(tmp_path / "user-data"),
            "NOTEBI_STATE_DIR": str(tmp_path / "user-state"),
            "NOTEBI_PROJECTS_DIR": str(tmp_path / "user-projects"),
        },
    )

    assert paths.data_dir == (tmp_path / "user-data").resolve()
    assert paths.state_dir == (tmp_path / "user-state").resolve()
    assert paths.projects_dir == (tmp_path / "user-projects").resolve()
