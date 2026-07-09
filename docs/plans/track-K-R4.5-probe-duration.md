---
title: Track K · R4.5 探测视频时长端点（取画面帧数预估的数据源）
status: ready
owner: mimo 执行（Claude 已定方案 + 目标代码）
depends_on: R4 §2（取画面 UI 的数据前提）
created: 2026-06-10
---

# Track K · R4.5：探测视频时长端点

> 📌 给 mimo：后端加 1 个轻量端点 + 前端加 1 个 service，**不碰 UI**。目标代码已写好照抄。后端 1 commit、前端可并入或单独 commit。

---

## 0. 目标

前端识别为视频后，能拿到**视频时长（秒）**，供下一步「取画面」算预估帧数。复用项目已有的 `fetch_ytdlp_metadata`（只取元数据、不下载），新增一个独立端点暴露时长——**不要改 `sniff_url`**（它刻意轻量、不调 yt-dlp、保证不抛异常）。

---

## 1. 现状锚点（不用再查）

- **复用函数**：`shared/video_download_ytdlp.py:594` → `fetch_ytdlp_metadata(url, *, log=None) -> dict`，返回 dict 含 `"duration"`（秒，int/float）。
- **端点文件**：`backend/app/routes/workspaces.py`，已有 `sniff-url` 端点（`rg -n "sniff-url|SniffUrlRequest" backend/app/routes/workspaces.py` 找到，仿它写）。`router` / `BaseModel` / `logger` 该文件都已 import。
- **前端 service**：`frontend/src/services/workspaces.ts:100` 的 `sniffUrl` 可仿；`BASE` 常量已定义（指向 workspaces 路由）。

---

## 2. 改动

### Step 1 · 后端加端点（`backend/app/routes/workspaces.py`，仿 sniff-url 放在它附近）

```python
class ProbeDurationRequest(BaseModel):
    url: str


@router.post("/probe-duration")
def probe_video_duration(req: ProbeDurationRequest) -> dict:
    """轻量探测视频时长（yt-dlp 只取元数据、不下载），供前端「取画面」算预估帧数。

    失败一律返回 0（前端据此回退到默认间隔），不抛异常、不阻塞识别流程。
    """
    from shared.video_download_ytdlp import fetch_ytdlp_metadata

    try:
        meta = fetch_ytdlp_metadata(req.url)
        return {"duration_sec": int(meta.get("duration") or 0)}
    except Exception:
        logger.warning("probe_video_duration failed for %s", req.url, exc_info=True)
        return {"duration_sec": 0}
```

> 若该文件的 `BaseModel` / `logger` import 名不同，按文件现有的来（别新加 import）。`router` 前缀已是 `/workspaces`，所以最终路径是 `POST /workspaces/probe-duration`。

### Step 2 · 前端加 service（`frontend/src/services/workspaces.ts`，仿 `sniffUrl`）

```typescript
export async function probeDuration(url: string): Promise<{ duration_sec: number }> {
  const res = await http.post<{ duration_sec: number }>(`${BASE}/probe-duration`, { url })
  return res.data
}
```

### Step 3 · 后端 mock 测试（`backend/tests/` 下新建 `test_probe_duration.py`）

```python
"""probe-duration 端点：复用 fetch_ytdlp_metadata 取时长，失败回退 0。"""

from fastapi.testclient import TestClient

from backend.app.main import app  # 若入口不在此，rg "TestClient" backend/tests 看现有测试怎么拿 app


def test_probe_duration_returns_seconds(monkeypatch):
    import shared.video_download_ytdlp as vd
    monkeypatch.setattr(vd, "fetch_ytdlp_metadata", lambda url, **kw: {"duration": 308})
    client = TestClient(app)
    r = client.post("/workspaces/probe-duration", json={"url": "https://example.com/v"})
    assert r.status_code == 200
    assert r.json()["duration_sec"] == 308


def test_probe_duration_failure_returns_zero(monkeypatch):
    import shared.video_download_ytdlp as vd
    def _boom(url, **kw):
        raise RuntimeError("yt-dlp down")
    monkeypatch.setattr(vd, "fetch_ytdlp_metadata", _boom)
    client = TestClient(app)
    r = client.post("/workspaces/probe-duration", json={"url": "https://example.com/v"})
    assert r.status_code == 200
    assert r.json()["duration_sec"] == 0
```

> ⚠️ `from backend.app.main import app` 的入口路径要核对——`rg -n "TestClient|app = FastAPI|^app" backend/tests backend/app | head` 看现有测试怎么拿到 app，按现有写法来。若现有测试用别的 fixture（如 `client` fixture），照搬。

---

## 3. 验证（自己跑，报数字）

```bash
# 后端
KMP_DUPLICATE_LIB_OK=TRUE /Users/conan/Desktop/nibi/.venv/bin/python -m pytest backend/tests/test_probe_duration.py -q
# 前端类型
cd /Users/conan/Desktop/nibi/frontend && npx tsc --noEmit
```
期望：pytest 2 passed / tsc EXIT=0。

---

## 4. 提交 + 红线

提交：`feat(k-10.R4.5): 探测视频时长端点 probe-duration（复用 fetch_ytdlp_metadata）`，带 Co-Authored-By，**不要 push**。

红线：
- ❌ **不要改 `shared/url_sniffer.py` 的 `sniff_url`**（它要轻量、不抛异常）。
- ❌ 不改 `fetch_ytdlp_metadata` 本身，只调用它。
- ❌ 不碰前端 UI（这步只加 service 函数，UI 是下一张卡 R4.6）。
- ⚠️ 端点路径确认是 `/probe-duration`（router 前缀已带 `/workspaces`），别写成 `/workspaces/workspaces/...`。
