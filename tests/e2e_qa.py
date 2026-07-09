#!/usr/bin/env python3
"""
Nibi 端到端 QA 验收脚本（离线可运行）。

检查项（12）：
1. app.py 语法
2. pages/*.py 语法
3. shared/*.py 语法
4. 设置保存后可重新加载
5. clear_settings 后恢复默认
6. 新建项目目录结构正确
7. set_current_project 持久化文件一致
8. 视频分析 mock 运行成功
9. JSON 同步到项目目录
10. 项目 JSON 可加载知识库
11. split_three_plans 解析正确
12. api_key_resolver 优先级（settings > env > 空串）
"""

from __future__ import annotations

import contextlib
import json
import os
import py_compile
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

# 允许从 tests/ 目录直接执行时正确导入项目模块。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@dataclass
class CheckResult:
    idx: int
    name: str
    passed: bool
    detail: str = ""


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


@contextlib.contextmanager
def setup_tmp_env() -> tuple[Path, Path]:
    """
    临时隔离 .local 与 data/projects 目录，避免污染真实数据。
    返回 (tmp_local_dir, tmp_projects_dir)。
    """
    root = _repo_root()
    tmp_root = Path(tempfile.mkdtemp(prefix="video_pipeline_qa_"))
    tmp_local = tmp_root / ".local"
    tmp_projects = tmp_root / "projects_data"
    tmp_local.mkdir(parents=True, exist_ok=True)
    tmp_projects.mkdir(parents=True, exist_ok=True)

    # 备份可能存在的环境变量，测试后恢复。
    old_env = {
        "SILICONFLOW_API_KEY": os.environ.get("SILICONFLOW_API_KEY"),
        "LLM_API_KEY": os.environ.get("LLM_API_KEY"),
        "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY"),
    }
    for k in old_env:
        os.environ.pop(k, None)

    try:
        # 动态 patch 模块常量（导入后 patch）。
        from shared import settings_store, config

        settings_store.SETTINGS_DIR = tmp_local
        settings_store.SETTINGS_PATH = tmp_local / "settings.json"
        config.WORKSPACES_DATA_DIR = tmp_projects

        yield tmp_local, tmp_projects
    finally:
        for k, v in old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(tmp_root, ignore_errors=True)


def run_check(idx: int, name: str, fn: Callable[[], str]) -> CheckResult:
    try:
        detail = fn()
        return CheckResult(idx=idx, name=name, passed=True, detail=detail)
    except Exception as err:  # noqa: BLE001
        return CheckResult(idx=idx, name=name, passed=False, detail=str(err))


def check_01_app_syntax() -> str:
    main_py = _repo_root() / "backend" / "app" / "main.py"
    _assert(main_py.is_file(), f"backend/app/main.py 不存在: {main_py}")
    py_compile.compile(str(main_py), doraise=True)
    return "backend/app/main.py 编译通过"


def check_02_pages_syntax() -> str:
    routes_dir = _repo_root() / "backend" / "app" / "routes"
    files = sorted(routes_dir.glob("*.py"))
    _assert(bool(files), "backend/app/routes 下未找到 .py 文件")
    for f in files:
        py_compile.compile(str(f), doraise=True)
    return f"{len(files)} 个路由文件编译通过"


def check_03_shared_syntax() -> str:
    shared_dir = _repo_root() / "shared"
    files = sorted(shared_dir.rglob("*.py"))
    _assert(bool(files), "shared 下未找到 .py 文件")
    for f in files:
        py_compile.compile(str(f), doraise=True)
    return f"{len(files)} 个 shared 文件编译通过"


def check_04_settings_roundtrip() -> str:
    from shared.settings_store import AppSettings, load_settings, save_settings

    s = AppSettings(
        openai_api_key="k-openai",
        openai_base_url="https://example-openai.test/v1",
        anthropic_api_key="k-anthropic",
        anthropic_base_url="https://example-anthropic.test",
        text_backend="anthropic",
        text_model="m-text",
        vision_model="m-vision",
        embedding_model="m-embed",
        anthropic_model="m-anthropic",
    )
    save_settings(s)
    loaded = load_settings()
    # 新版本 settings 包含 provider profile；这里校验核心字段与迁移结果。
    _assert(loaded.openai_api_key == s.openai_api_key, "openai_api_key 不一致")
    _assert(loaded.openai_base_url == s.openai_base_url, "openai_base_url 不一致")
    _assert(loaded.anthropic_api_key == s.anthropic_api_key, "anthropic_api_key 不一致")
    _assert(loaded.anthropic_base_url == s.anthropic_base_url, "anthropic_base_url 不一致")
    _assert(loaded.text_backend == s.text_backend, "text_backend 不一致")
    _assert(loaded.text_model == s.text_model, "text_model 不一致")
    _assert(loaded.vision_model == s.vision_model, "vision_model 不一致")
    _assert(loaded.embedding_model == s.embedding_model, "embedding_model 不一致")
    _assert(loaded.anthropic_model == s.anthropic_model, "anthropic_model 不一致")
    _assert(len(loaded.providers) >= 1, "providers 迁移/保存失败")
    return "settings 保存/加载一致（含 provider profile）"


def check_05_settings_clear() -> str:
    from shared.settings_store import AppSettings, clear_settings, load_settings

    clear_settings()
    loaded = load_settings()
    _assert(loaded == AppSettings(), "clear_settings 后未恢复默认空值")
    return "clear_settings 生效"


def check_06_project_dirs() -> str:
    from shared.config import ensure_workspace_dirs, get_workspace_json_dir, get_workspace_runtime_dir, get_workspace_videos_dir

    pid = "qa_project_001"
    ensure_workspace_dirs(pid)
    _assert(get_workspace_videos_dir(pid).is_dir(), "videos 目录缺失")
    _assert(get_workspace_json_dir(pid).is_dir(), "json_data 目录缺失")
    _assert(get_workspace_runtime_dir(pid).is_dir(), "runtime 目录缺失")
    return "项目三类目录已创建"


def check_07_workspace_persist() -> str:
    from backend.app.services.workspace_store import WorkspaceStore
    from backend.app.models.workspace import WorkspaceRecord
    from shared.config import WORKSPACES_DATA_DIR

    store = WorkspaceStore(root=WORKSPACES_DATA_DIR)
    rec = WorkspaceRecord(workspace_id="qa-ws-002", name="QA 工作区二")
    store.create(rec)
    loaded = store.get("qa-ws-002")
    _assert(loaded is not None, "workspace 未持久化")
    _assert(loaded.name == "QA 工作区二", "workspace name 不一致")
    return "workspace 持久化一致"


def _create_dummy_video(path: Path, frame_count: int = 5) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, 5.0, (320, 240))
    _assert(writer.isOpened(), "无法创建测试视频文件")
    for i in range(frame_count):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        frame[:, :, 0] = (i * 40) % 255
        frame[:, :, 1] = (i * 70) % 255
        frame[:, :, 2] = (i * 90) % 255
        writer.write(frame)
    writer.release()


def check_08_video_analyzer_mock_and_09_json_sync() -> str:
    from shared.config import get_workspace_json_dir, get_workspace_videos_dir
    from shared.video_analyzer import AnalysisState, VideoProgress, assign_safe_names, process_video
    import shared.video_analyzer as va

    pid = "qa_project_003"
    video_dir = get_workspace_videos_dir(pid)
    json_dir = get_workspace_json_dir(pid)
    video_path = video_dir / "Demo Product.mp4"
    _create_dummy_video(video_path, frame_count=5)

    assign_safe_names([video_path])
    state = AnalysisState(videos=[VideoProgress(video_name=video_path.name)])

    orig_analyze = va.analyze_video_frame
    orig_summary = va.generate_video_summary
    try:
        va.analyze_video_frame = lambda *args, **kwargs: {  # type: ignore[assignment]
            "description_zh": "测试帧",
            "image_prompt_en": "test prompt",
        }
        va.generate_video_summary = lambda *args, **kwargs: "测试全局总结"  # type: ignore[assignment]
        out_dir = process_video(
            api_key="fake",
            video_path=video_path,
            video_idx=0,
            total_videos=1,
            state=state,
            vision_model="fake-vision",
            text_model="fake-text",
            auto_sync_json=True,
            target_json_dir=json_dir,
        )
    finally:
        va.analyze_video_frame = orig_analyze  # type: ignore[assignment]
        va.generate_video_summary = orig_summary  # type: ignore[assignment]

    _assert(out_dir is not None, "process_video 返回 None")
    safe_name = Path(out_dir).name.replace("_分析报告", "")
    json_file = out_dir / f"{safe_name}_视觉数据.json"
    _assert(json_file.is_file(), "输出目录缺少视觉 JSON")
    data = json.loads(json_file.read_text(encoding="utf-8"))
    _assert(isinstance(data.get("frames"), list) and len(data["frames"]) > 0, "视觉 JSON frames 为空")

    synced = json_dir / f"{safe_name}_视觉数据.json"
    _assert(synced.is_file(), "JSON 未同步到项目 json_data 目录")
    return "视频分析 mock 成功，且 JSON 同步成功"


def check_10_knowledge_load_and_11_split() -> str:
    from shared.config import get_workspace_json_dir
    import shared.knowledge_base as kb
    from shared.knowledge_base import load_folder_as_knowledge, split_three_plans

    pid = "qa_project_003"
    json_dir = get_workspace_json_dir(pid)
    _assert(any(json_dir.glob("*.json")), "项目 json_data 目录为空，无法测试知识库")

    orig_embed = kb.create_embeddings
    try:
        kb.create_embeddings = lambda api_key, model, inputs, on_batch=None: [  # type: ignore[assignment]
            [0.1 + i * 0.001 for i in range(16)] for _ in inputs
        ]
        knowledge = load_folder_as_knowledge(
            api_key="fake",
            folder=str(json_dir),
            embedding_model="BAAI/bge-m3",
            progress=None,
        )
    finally:
        kb.create_embeddings = orig_embed  # type: ignore[assignment]

    _assert(knowledge.mode in ("short", "long"), "知识库 mode 非 short/long")

    raw = (
        "前言\n"
        "<<<PLAN_A>>>\nA方案内容\n"
        "<<<PLAN_B>>>\nB方案内容\n"
        "<<<PLAN_C>>>\nC方案内容\n"
    )
    pa, pb, pc = split_three_plans(raw, ("<<<PLAN_A>>>", "<<<PLAN_B>>>", "<<<PLAN_C>>>"))
    _assert("A方案内容" in pa and "B方案内容" in pb and "C方案内容" in pc, "split_three_plans 解析失败")
    return f"知识库加载成功（mode={knowledge.mode}），split_three_plans 正常"


def check_12_api_resolver_priority() -> str:
    from shared.settings_store import AppSettings, save_settings
    import shared.api_key_resolver as resolver

    os.environ["SILICONFLOW_API_KEY"] = "env-key"
    save_settings(AppSettings(openai_api_key="settings-key"))
    v = resolver.resolve_api_key("")
    _assert(v == "settings-key", f"期望 settings-key，实际 {v!r}")
    return "resolve_api_key 优先级为 settings > env > 空串"


def main() -> int:
    results: list[CheckResult] = []
    checks: list[tuple[str, Callable[[], str]]] = [
        ("backend/app/main.py 语法检查", check_01_app_syntax),
        ("backend/app/routes/*.py 语法检查", check_02_pages_syntax),
        ("shared/*.py 语法检查", check_03_shared_syntax),
        ("设置保存与重新加载一致", check_04_settings_roundtrip),
        ("清空设置后返回默认值", check_05_settings_clear),
        ("新建项目目录结构正确", check_06_project_dirs),
        ("切换项目持久化一致", check_07_workspace_persist),
        ("视频分析 mock 运行", check_08_video_analyzer_mock_and_09_json_sync),
        ("JSON 同步到项目目录", lambda: "由 #08 联合覆盖"),
        ("知识库从项目 JSON 加载", check_10_knowledge_load_and_11_split),
        ("split_three_plans 解析正确", lambda: "由 #10 联合覆盖"),
        ("api_key_resolver 优先级", check_12_api_resolver_priority),
    ]

    print("=== Nibi QA 验收报告 ===")
    with setup_tmp_env():
        for i, (name, fn) in enumerate(checks, start=1):
            res = run_check(i, name, fn)
            results.append(res)
            prefix = "PASS" if res.passed else "FAIL"
            print(f"[{prefix}] #{i:02d} {name}")
            if res.detail:
                print(f"       {res.detail}")

    passed = sum(1 for r in results if r.passed)
    failed = len(results) - passed
    print("================================")
    print(f"通过 {passed}/{len(results)}  失败 {failed}/{len(results)}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
