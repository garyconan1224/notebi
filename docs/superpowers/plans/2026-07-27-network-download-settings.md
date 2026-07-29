# Network and Download Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让网络与下载设置成为后端持久化的真实配置，形成可解释、可测试、可读回的闭环，并移除 PO Token 与 Visitor Data。

**Architecture:** `shared/settings_store.py` 保存 `NetworkConfig` 与 `DownloadConfig`；FastAPI 提供 GET/PATCH/测试/Cookie 管理接口；pipeline 和 yt-dlp 只消费后端有效配置；前端页面在进入时加载、保存后读回，使用同一 SaveBar。

**Tech Stack:** FastAPI、Pydantic、Python pathlib、yt-dlp、React、TypeScript、Zustand、Vitest、Pytest。

---

## Task 1: 冻结设置模型和兼容迁移

**Files:**
- Modify: `shared/settings_store.py`
- Test: `tests/backend/test_settings_store.py`

- [ ] 写失败测试：旧 JSON 含 `po_token`、`visitor_data`、`cookie_base_dirs` 时能加载，但重新保存不再序列化这些字段。
- [ ] 写失败测试：新配置默认值为智能路由、继承网络代理、浏览器 Cookie、并发 2、重试 2、超时 30 秒。

```python
def test_legacy_download_secrets_are_read_but_not_written(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(
        '{"download":{"po_token":"old","visitor_data":"old","cookie_base_dirs":["/tmp"]}}',
        encoding="utf-8",
    )
    store = SettingsStore(path)
    store.save(store.load())
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert "po_token" not in saved["download"]
    assert "visitor_data" not in saved["download"]
    assert "cookie_base_dirs" not in saved["download"]
```

- [ ] 运行 `./.venv/bin/pytest tests/backend/test_settings_store.py -q`，确认因新字段不存在而失败。
- [ ] 实现模型：

```python
class NetworkConfig(BaseModel):
    routing_mode: Literal["smart", "direct", "proxy"] = "smart"
    global_proxy: str = ""

class DownloadConfig(BaseModel):
    output_dir: str = ""
    filename_template: str = "%(title)s.%(ext)s"
    proxy_mode: Literal["inherit", "direct", "proxy"] = "inherit"
    cookie_mode: Literal["none", "browser", "file"] = "browser"
    cookie_browser: str = "chrome"
    cookie_profile: str = ""
    cookie_file: str = ""
    concurrency_limit: int = Field(default=2, ge=1, le=8)
    retry_count: int = Field(default=2, ge=0, le=10)
    socket_timeout: int = Field(default=30, ge=5, le=300)
```

- [ ] `from_dict` 只负责兼容读取旧字段，不把旧字段放回实例；`to_dict` 只输出新字段。
- [ ] 运行测试确认通过。
- [ ] 提交：`feat(settings): define network and download source of truth`

## Task 2: 网络设置 API 和连通性测试

**Files:**
- Create: `backend/app/routes/network_config.py`
- Modify: `backend/app/main.py`
- Modify: `shared/config.py`
- Test: `tests/backend/test_network_config.py`

- [ ] 写失败测试覆盖 GET、PATCH、非法代理、测试目标和保存读回。

```python
def test_patch_network_config_round_trips(client):
    response = client.patch(
        "/network_config",
        json={"routing_mode": "smart", "global_proxy": "http://127.0.0.1:7890"},
    )
    assert response.status_code == 200
    assert client.get("/network_config").json() == response.json()

@pytest.mark.parametrize("target", ["domestic", "overseas", "proxy", "tavily"])
def test_network_target_is_explicit(client, target):
    response = client.post("/network_config/test", json={"target": target})
    assert response.status_code in {200, 424}
    assert response.json()["target"] == target
```

- [ ] 测试必须 mock DNS/HTTP 目标，避免把公网可用性当单元测试前提。
- [ ] 实现 `GET /network_config`、`PATCH /network_config` 和 `POST /network_config/test`。
- [ ] 测试结果返回 `target`、`route`、`proxy_used`、`elapsed_ms`、`ok`、`message`，不得返回代理密码。
- [ ] `global_proxy` 仅允许空值或 `http://`、`https://`、`socks5://`；错误返回 422。
- [ ] 运行 `./.venv/bin/pytest tests/backend/test_network_config.py -q`。
- [ ] 提交：`feat(settings): add network configuration API`

## Task 3: 智能路由成为唯一决策函数

**Files:**
- Create: `shared/network_routing.py`
- Modify: `shared/video_download_ytdlp.py`
- Modify: `backend/app/services/pipeline_tasks.py`
- Modify: actual Tavily/model client files found with `rg -n "tavily|httpx|AsyncOpenAI|OpenAI\\(" backend shared`
- Test: `tests/backend/test_network_routing.py`
- Test: `tests/backend/test_pipeline_tasks.py`

- [ ] 写路由矩阵失败测试。

```python
@pytest.mark.parametrize(
    ("url", "mode", "expected"),
    [
        ("https://www.bilibili.com/video/BV1xx", "smart", None),
        ("https://www.douyin.com/video/1", "smart", None),
        ("https://www.youtube.com/watch?v=x", "smart", "http://proxy:7890"),
        ("https://example.com/file.mp4", "direct", None),
        ("https://www.bilibili.com/video/BV1xx", "proxy", "http://proxy:7890"),
    ],
)
def test_resolve_proxy(url, mode, expected):
    config = NetworkConfig(routing_mode=mode, global_proxy="http://proxy:7890")
    assert resolve_proxy(url, config) == expected
```

- [ ] 实现纯函数 `resolve_proxy(url, network, override="inherit")`；国内域名表至少含 Bilibili、抖音、小红书，海外默认走全局代理。
- [ ] `proxy_mode=direct` 强制直连；`proxy_mode=proxy` 强制代理；`inherit` 使用网络页策略。
- [ ] pipeline、yt-dlp、Tavily 和模型 HTTP 客户端调用同一决策函数，不各自复制判断。
- [ ] 没有全局代理时，智能路由允许海外直连并在测试结果说明“未配置代理”，不得静默伪造成功。
- [ ] 运行定向测试。
- [ ] 提交：`feat(network): centralize smart routing`

## Task 4: 下载目录和文件名真实生效

**Files:**
- Modify: `backend/app/routes/download_config.py`
- Modify: `backend/app/services/pipeline_tasks.py`
- Modify: `shared/video_download_ytdlp.py`
- Test: `tests/backend/test_download_config.py`
- Test: `tests/backend/test_pipeline_tasks.py`
- Test: `tests/backend/test_video_download_ytdlp.py`

- [ ] 写失败测试：空 `output_dir` 使用现有 workspace videos 目录；非空时使用 `<root>/<workspace_id>/videos`。

```python
def test_custom_output_root_is_scoped_by_workspace(tmp_path):
    config = DownloadConfig(output_dir=str(tmp_path))
    assert resolve_workspace_media_dir(config, "ws-1") == tmp_path / "ws-1" / "videos"
```

- [ ] 写失败测试：非法模板（绝对路径、`..`、空扩展表达式）返回 422。
- [ ] 写失败测试：pipeline 实际传给 downloader 的目录、模板、并发、重试和超时与保存值一致。
- [ ] 实现 `resolve_workspace_media_dir`；只影响新下载，不移动旧文件。
- [ ] 输出目录创建失败返回可读错误，并写标准日志；不得回退到未提示的其他目录。
- [ ] 并发限制作用于任务调度，不把值只传给无消费方。
- [ ] 运行定向测试。
- [ ] 提交：`fix(download): apply persisted download settings`

## Task 5: Cookie 浏览器优先、文件回退

**Files:**
- Modify: `backend/app/routes/download_config.py`
- Create: `backend/app/services/cookie_config.py`
- Modify: `shared/video_download_ytdlp.py`
- Test: `tests/backend/test_download_config.py`
- Test: `tests/backend/test_video_download_ytdlp.py`

- [ ] 写失败测试覆盖浏览器、指定 profile、cookies.txt 导入、删除和权限。

```python
def test_imported_cookie_is_private(client, tmp_path):
    response = client.post(
        "/download_config/import-cookie",
        files={"file": ("cookies.txt", b"# Netscape HTTP Cookie File\n")},
    )
    assert response.status_code == 200
    cookie_path = Path(response.json()["stored_path"])
    assert stat.S_IMODE(cookie_path.stat().st_mode) == 0o600
    assert "Netscape" not in json.dumps(response.json())
```

- [ ] `POST /download_config/test-cookie` 只返回模式、浏览器、是否可读和提示，不返回 Cookie 内容。
- [ ] 浏览器模式转换为 yt-dlp `cookiesfrombrowser=(browser, profile or None, None, None)`；文件模式转换为 `cookiefile`。
- [ ] 文件导入仅接受 Netscape 格式文本，限制大小，保存到应用私有目录并 `chmod 0600`。
- [ ] `DELETE /download_config/cookie` 删除导入文件并把模式切回 browser。
- [ ] PO Token 与 Visitor Data 不再进入 yt-dlp extractor args。
- [ ] 运行定向测试。
- [ ] 提交：`feat(download): add safe cookie fallback`

## Task 6: 前端网络页闭环

**Files:**
- Create: `frontend/src/services/network.ts`
- Modify: `frontend/src/pages/SettingPage/NetworkSettingsPage.tsx`
- Modify: `frontend/src/store/configStore.ts`
- Test: `frontend/src/__tests__/NetworkSettingsPage.test.tsx`

- [ ] 写失败测试：进入页面 GET；修改后 PATCH；成功后再次 GET 并以读回值更新 UI。
- [ ] 写失败测试：智能/直连/代理三种模式说明可见；四个测试按钮显示使用的路由；代理密码不显示在结果。
- [ ] 写失败测试：页面中不存在 `PO Token`、`Visitor Data`、`poToken`、`visitorData`。

```tsx
expect(screen.getByText('智能路由')).toBeVisible()
expect(screen.getByText(/国内站点优先直连/)).toBeVisible()
expect(screen.queryByText(/PO Token|Visitor Data/)).not.toBeInTheDocument()
```

- [ ] 删除 localStorage 对网络核心字段的事实源角色；允许只缓存未保存表单状态。
- [ ] 只保留 SettingsShell 底部 SaveBar，删除页头重复保存/重置。
- [ ] 保存失败保留用户输入并显示后端错误；成功显示“已保存并读回”。
- [ ] 运行 `cd frontend && pnpm test --run src/__tests__/NetworkSettingsPage.test.tsx`。
- [ ] 提交：`feat(settings-ui): connect network settings`

## Task 7: 前端下载页闭环和教程

**Files:**
- Modify: `frontend/src/services/download.ts`
- Modify: `frontend/src/pages/SettingPage/DownloadSettingsPage.tsx`
- Modify: `frontend/src/store/configStore.ts`
- Test: `frontend/src/__tests__/DownloadSettingsPage.test.tsx`

- [ ] 写失败测试：页面 mount 调用 `loadDownloadConfig()`；保存后 GET 读回。
- [ ] 写失败测试：常驻显示目录、命名、并发、重试、超时、代理继承、Cookie 模式；没有 PO Token/Visitor Data。
- [ ] 写失败测试：选择 cookies.txt 后先说明格式和隐私，再上传；删除后回到浏览器模式。
- [ ] 每一项旁边提供“做什么/何时改”的一句话说明；Cookie 教程包含浏览器关闭占用、profile 选择和 cookies.txt 导出注意事项，不推荐复制 Cookie 正文到页面。
- [ ] 只保留一个 SaveBar。
- [ ] 运行定向前端测试和 `pnpm build`。
- [ ] 提交：`feat(settings-ui): connect download settings`

## Task 8: 阶段验收

- [ ] 运行：

```bash
./.venv/bin/pytest tests/backend/test_settings_store.py tests/backend/test_network_config.py tests/backend/test_network_routing.py tests/backend/test_download_config.py tests/backend/test_pipeline_tasks.py tests/backend/test_video_download_ytdlp.py -q
cd frontend
pnpm test --run src/__tests__/NetworkSettingsPage.test.tsx src/__tests__/DownloadSettingsPage.test.tsx
pnpm build
cd ..
git diff --check
```

- [ ] 浏览器手测：保存网络和下载配置，刷新页面，值保持一致。
- [ ] 使用 mock/本地代理证据证明智能路由选择正确；公网失败只能说明环境，不替代路由断言。
- [ ] 用一条真实 Bilibili 和一条真实 YouTube 输入验证 downloader 收到预期 proxy/Cookie 参数；若外网不可达，保留参数证据并标“需要补充真实下载验证”。
- [ ] 检查日志和响应不含代理密码、Cookie、API key。
- [ ] 验收提交只含测试、证据和状态文档：`test(acceptance): verify network and download settings`
