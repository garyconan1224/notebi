# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


spec_dir = Path(SPECPATH)
repo_root = spec_dir.parent
hidden_imports = collect_submodules("backend.app") + collect_submodules("shared")

a = Analysis(
    [str(spec_dir / "desktop_backend.py")],
    pathex=[str(repo_root)],
    binaries=[],
    datas=[
        (
            str(repo_root / "backend/app/services/av_synthesis/templates"),
            "backend/app/services/av_synthesis/templates",
        ),
    ],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["backend.tests", "pytest"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="notebi-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="notebi-backend",
)
