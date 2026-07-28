import stat

from backend.app.services import cookie_config


def test_cookie_import_requires_netscape_header(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(cookie_config, "_COOKIE_DIR", tmp_path)
    monkeypatch.setattr(
        cookie_config,
        "_IMPORTED_COOKIE_FILE",
        tmp_path / "imported_cookies.txt",
    )
    result = cookie_config.import_cookie_file("session=secret")
    assert result["success"] is False
    assert not (tmp_path / "imported_cookies.txt").exists()


def test_cookie_import_is_private_and_file_mode_builds_cookiefile(
    tmp_path,
    monkeypatch,
) -> None:
    target = tmp_path / "imported_cookies.txt"
    monkeypatch.setattr(cookie_config, "_COOKIE_DIR", tmp_path)
    monkeypatch.setattr(cookie_config, "_IMPORTED_COOKIE_FILE", target)
    content = (
        "# Netscape HTTP Cookie File\n"
        ".example.com\tTRUE\t/\tFALSE\t0\tsession\tsecret\n"
    )
    result = cookie_config.import_cookie_file(content)
    assert result["success"] is True
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert cookie_config.build_ytdlp_cookie_args("file") == {
        "cookiefile": str(target)
    }


def test_browser_cookie_args_include_profile() -> None:
    assert cookie_config.build_ytdlp_cookie_args(
        "browser",
        "chrome",
        "Profile 1",
    ) == {
        "cookiesfrombrowser": ("chrome", "Profile 1", None, None),
    }
