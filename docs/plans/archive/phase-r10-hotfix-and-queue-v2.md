---
name: phase-r10-hotfix-and-queue-v2
status: done
branch: feat/phase-r10-hotfix-and-queue-v2
baseline_commit: cd91447  # R9 merge 后的 main
owner: ds (claude code + ccswitch deepseek-v4-pro)
created_date: 2026-05-25
completed_date: 2026-05-25
commits:
  - 62b4f27 docs(phase-r10): 平台 URL 音频抽取 hotfix + 悬浮队列 v2 执行计划
  - ee204d6 fix(phase-r10): R10.0 audio_task 平台 URL 改用 yt-dlp 抽 bestaudio，修复 B 站 412 与同类拦截
  - R10 completion: FloatingTaskQueue v2 视觉/取消/重试/隐藏/批量操作 + 回归测试
---

# Phase R10 — 平台 URL 音频抽取 hotfix + 悬浮队列 v2

## 范围

两块独立工作打一个 phase，因为 R10.1 修复后才能验证 R10.2~R10.5 的真实数据。

| 部分 | 主题 |
|---|---|
| R10.0 | **hotfix**：audio_task 平台 URL → yt-dlp bestaudio（修 B 站 412 / 其他平台同类问题） |
| R10.1~R10.5 | 悬浮队列 v2：视觉精修 + 当前步骤 + 取消按钮 + 重试按钮 + 隐藏已终结 |

---

## 完成记录（2026-05-25）

- R10.0 已修复平台 URL 音频任务：B 站 / YouTube / 抖音等平台 URL 改走 yt-dlp `bestaudio/best`，直链音频仍走 urllib。
- R10.1~R10.5 已补齐：胶囊 mini ring、popover 聚合进度、stage 行、取消按钮、失败重试、FAILED 本地隐藏、footer 批量暂停/重试、当前 processing 任务高亮。
- `查看全部` 指向现有 `/workspaces`，避免跳转未注册 `/taskboard`。
- FAILED 本地隐藏通过 `hiddenTaskIds` 防止轮询把同一后端失败记录重新同步回来。
- 验证：后端全量 `318 passed, 2 skipped`；前端全量 `47 passed`；前端 build passed；R10 touched files targeted eslint passed；完整 `pnpm lint` 仍是项目存量 `49 errors / 2 warnings`。

---

## R10.0 — audio_task 平台 URL hotfix ⭐ 阻塞修复

### 背景

用户跑 B 站视频时，sniff 返回 `possible_types=["video","audio"]`（[shared/url_sniffer.py:26](shared/url_sniffer.py)），R7.2 多类型默认全勾导致 video + audio 双任务。video 走 yt-dlp 正常，audio 走 [backend/app/services/pipeline_tasks.py:1970](backend/app/services/pipeline_tasks.py) 用 `urllib.request.urlopen` 直 GET B 站网页地址，B 站对裸 UA + 无 cookie 直接返回 **412 Precondition Failed**。

**同类问题不止 B 站**：YouTube / 抖音 / 快手 / 小红书 任何会被 sniff 标 `audio` 的平台 URL，都会走同一段死代码（urllib 直 GET 网页 URL），结果可能是 403 / 429 / 302 重定向 / 反爬拦截。

### 修复方案

在 [pipeline_tasks.py:1962](backend/app/services/pipeline_tasks.py)（`if source_type == "url":` 分支）加平台判断：

```python
# 新增 import
from shared.video_download_ytdlp import run_ytdlp_download

# 在 url 分支内 audio_local_path 计算后、urllib 之前
_is_platform = _is_platform_url(source)  # 新增 helper，见下方

if _music_confirmed and audio_local_path.exists():
    log("📦 音频文件已存在（重跑），跳过下载")
    audio_bytes = audio_local_path.read_bytes()
elif _is_platform:
    # 平台 URL → 走 yt-dlp 抽 bestaudio
    log(f"🎬 检测到平台 URL，使用 yt-dlp 抽取音频流")
    result = run_ytdlp_download(
        url=source,
        output_dir=str(audio_dir),
        format_selector="bestaudio/best",
        log=lambda m: runner.append_log(task_id, m),
        progress_callback=lambda p, msg: runner.set_progress(task_id, 0.05 + p * 0.1, msg),
    )
    if not result.get("ok"):
        raise RuntimeError(f"音频下载失败（yt-dlp）：{result.get('error', '未知错误')}")
    audio_local_path = Path(result["save_path"])
    audio_filename = audio_local_path.name
    audio_bytes = audio_local_path.read_bytes()
    content_type = ""  # yt-dlp 已保证文件类型
else:
    # 直链音频 → urllib 直 GET（原逻辑保留）
    req = urllib.request.Request(source, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            audio_bytes = resp.read()
            content_type = resp.headers.get("Content-Type", "")
    except Exception as err:
        raise RuntimeError(f"音频下载失败：{err}") from err
    audio_local_path.write_bytes(audio_bytes)
```

### `_is_platform_url` helper

在 `shared/video_download_ytdlp.py` 新增公开导出（已有私有 `_is_bilibili_url` / `_is_youtube_url` / `_is_douyin_url`）：

```python
def is_platform_url(url: str) -> bool:
    """检测 URL 是否属于已知需要 yt-dlp 处理的视频平台。
    覆盖 bilibili / youtube / douyin / kuaishou / xiaohongshu / weibo 等。
    """
    if not url:
        return False
    u = url.lower()
    needles = (
        "bilibili.com", "b23.tv",
        "youtube.com", "youtu.be",
        "douyin.com", "iesdouyin.com", "v.douyin", "dy.com",
        "kuaishou.com", "kwai.com",
        "xiaohongshu.com", "xhslink.com",
        "weibo.com", "weibo.cn",
        "twitter.com", "x.com",
        "tiktok.com",
    )
    return any(n in u for n in needles)
```

如果项目里已有 `PLATFORMS` 字典（前端 [WorkbenchPage/platforms.ts](frontend/src/pages/WorkbenchPage/platforms.ts) 已有，但是 TS），后端不要重复造，**新建 helper 函数即可**，不要重构。

### 测试

**新增** `tests/backend/test_audio_task_platform_url.py`：

1. happy path：mock `run_ytdlp_download` 返回 `{ok:True, save_path:'/tmp/x.m4a', ...}` → 提交 B 站 URL audio 任务 → 断言 yt-dlp 被调而非 urllib
2. 直链音频：传 `https://example.com/foo.mp3` → 断言走 urllib 分支
3. yt-dlp 失败：mock 返回 `{ok:False, error:'412'}` → 任务 FAILED 且 error 含 yt-dlp 错误

### 验收

- `.venv/bin/python -m pytest tests/backend/test_audio_task_platform_url.py -q` 通过
- 手测：粘贴一个 B 站短视频 URL → 一键解析 → 视频 + 音频任务都跑通（音频任务走 yt-dlp 抽 m4a/opus）
- 看后端日志没有 412/403/429

**commit**：`fix(phase-r10): R10.0 audio_task 平台 URL 改用 yt-dlp 抽 bestaudio，修复 B 站 412 与同类拦截`

---

## R10.1~R10.5 — FloatingTaskQueue v2

### 设计稿真相源 ⭐

`/Users/conan/Downloads/vidmirror (Remix)/components/p1_features.jsx` **L160-370**（§11.3 FloatingQueue 组件）。
用户截图就是这个组件的胶囊收起态。**请 DS 完整读这 210 行再动手**，不要凭印象写。

### 当前现状

R9 已实现的基础（[frontend/src/components/FloatingTaskQueue.tsx](frontend/src/components/FloatingTaskQueue.tsx)）：
- 胶囊 + popover ✅
- 有活跃任务时显示，全部终结后隐藏 ✅
- popover 每行显示 progress %
- 点击任务跳 `/processing/{taskId}` ✅
- 底部"查看全部"链接到 `/workspaces`

### Remix 设计 vs 当前 R9 差异（R10.1~R10.5 要补的）

| # | 项 | Remix 设计稿 | R9 现状 |
|---|---|---|---|
| A | 胶囊圆环 | SVG `<circle r=8.5>` mini ring + 中心百分比文字 | 没有 |
| B | 胶囊文案 | 主行 `任务 · N 项进行中` + 副行 `● N 处理 · ○ N 等待 · ✗ N 失败` | 文案不符 |
| C | 胶囊背景 | `var(--ink)` 深色，文字 `var(--bg)` | 待对齐 |
| D | popover 宽度 | **380px** max-height 70vh | 320px |
| E | popover header | `任务 · 近期活跃` eyebrow + `N/total 处理中 · 平均 N%` mono | 待对齐 |
| F | header 聚合条 | 渐变 progress bar（`linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-green))`） | 没有 |
| G | 每行两层 | title 行 + 细 progress bar 行（含 stage mono 文本） | 单行 |
| H | running dot 动画 | `proc-blink` 1.6s infinite 闪烁 | 没有 |
| I | currentTaskId 高亮 | 边框 left `2px var(--accent)` + 背景 `var(--bg-sunken)` + `查看中` 红 pill | 没有 |
| J | error 行 | title 文字红 + progress 显示 `FAIL` + 第二行末尾**内联重试按钮** | 没有 |
| K | footer 批量 | **暂停全部** + **重试 N 项**（disabled if `errored===0`） | 仅"查看全部" |

### 子任务

每步独立 commit，做完跑 `pnpm lint && pnpm build && pnpm test --run`。

---

#### R10.1 — 视觉骨架对齐 + 每行 stage 显示

按 p1_features.jsx 重写组件骨架：

- **胶囊**（参考 L202-242）：
  - `position: fixed; right: 24px; bottom: 24px; z-index: 38`
  - 内嵌 SVG mini ring（r=8.5, stroke=2, accent-green 进度环 + rgba(255,255,255,0.18) 底环 + 中心百分比 text）
  - 文案：`任务 · {running+queued+errored} 项进行中` / `● {running} 处理 · ○ {queued} 等待 · ✗ {errored} 失败`
  - 颜色 token 化（hardcoded `rgba(255,255,255,0.18)` 留底环用即可，其余用 var）
- **popover**（参考 L244-365）：宽 380、max-height 70vh、border-radius 16、`var(--shadow-lg)`
- **header**：`任务 · 近期活跃` eyebrow + `N/total 处理中 · 平均 N%` mono
- **聚合进度条**：渐变 bar 显示 `avgPct = round(sum(progress) / total)`
- **每行两层**：
  - 第一层：7px dot（running blink）+ title（error 红）+ 右侧 `查看中` pill（如适用）+ 进度文本 `N%` 或 `FAIL`
  - 第二层：细 progress bar（高 2px）+ stage mono 文本 + error 行末尾重试按钮（R10.3 引入，先占位 div）
- **stage 名映射**：从 `PROCESSING_STAGES` ([frontend/src/types/task.ts](frontend/src/types/task.ts)) 拿，写 helper `getStageLabel`：
  - DOWNLOAD→`下载`、PROBE→`探测`、ASR→`转写`、FRAMES→`截帧`、VLM→`视觉分析 · {N/M}`（暂用 stage 名，VLM 子进度后续接）、SUM→`总结`、STORE→`入库`、PENDING→`等待槽位`
- **proc-blink keyframe**：写进 `FloatingTaskQueue.css`：
  ```css
  @keyframes proc-blink { 0%,100%{opacity:1} 50%{opacity:0.35} }
  ```

⚠️ 颜色一律 var(--*)，唯一例外是 mini ring 底环的 `rgba(255,255,255,0.18)`（Remix 设计稿原样保留，因为胶囊背景是 ink，需要白半透）。

**commit**：`feat(phase-r10): R10.1 FloatingTaskQueue v2 视觉骨架对齐 p1_features.jsx §11.3`

---

#### R10.2 — 进行中任务的取消按钮（用户加项，Remix 没有）

Remix 设计**没有每行取消按钮**，但用户明确要求加。规则：

- 每行第二层（progress bar 行）末尾，重试按钮**右侧**或同位置（互斥）：
  - **非终结态**（PENDING / DOWNLOAD / PROBE / ASR / FRAMES / VLM / SUM / STORE / AWAITING_CONFIRM）→ 显示 14px ✕ 按钮
  - 点击调 `useTaskStore.cancelTask(taskId)`，`e.stopPropagation()` 阻止冒泡
  - 视觉：与 Remix 重试按钮同尺寸 `height:20 padding:'0 7px'`，icon 10px，`color: var(--ink-3); hover: var(--accent)`

**commit**：`feat(phase-r10): R10.2 popover 进行中任务支持取消按钮`

---

#### R10.3 — 失败任务的重试按钮（按 Remix 原设计位置）

按 p1_features.jsx L337-343：

```jsx
{r.state === 'error' && (
  <button className="btn btn-ghost"
          style={{ height:20, padding:'0 7px', fontSize:10 }}
          onClick={(e) => { e.stopPropagation(); /* retry */ }}>
    <ErrIcRefresh size={10}/>重试
  </button>
)}
```

- **status === 'FAILED'** → 第二层末尾显示重试按钮
- 点击调 `useTaskStore.retryTask(taskId)`，阻止冒泡
- icon 用 lucide `RotateCcw` 10px

**commit**：`feat(phase-r10): R10.3 popover 失败任务支持重试按钮（对齐 Remix 内联位置）`

---

#### R10.4 — 已终结任务过滤 + 失败本地隐藏

按用户决议：

```ts
const visible = tasks
  .filter(t => !isTaskTerminal(t.status) || t.status === 'FAILED')
  .sort((a, b) => b.updated_at - a.updated_at)
  .slice(0, 8)
```

- SUCCESS / CANCELLED → 自动从 popover 消失（仍在后端记录，可在任务中心查）
- FAILED 保留显示
- **FAILED 行的 ✕ 按钮语义改为"本地隐藏"**：调 `useTaskStore.removeTask(taskId)`（R9.2 已加），不删后端
  - 实现方式：R10.2 的 ✕ 按钮 onClick 根据 status 分支：非终结→`cancelTask`；FAILED→`removeTask`

**commit**：`feat(phase-r10): R10.4 popover 隐藏成功/取消任务，FAILED 行 ✕ 改为本地隐藏`

---

#### R10.5 — Footer 批量操作 + 当前路由高亮

按 p1_features.jsx L349-363：

**Footer 改造**：保留"查看全部"链接的同时，加 Remix 的批量按钮行：

```jsx
<div className="ftq-foot-batch">
  <button className="btn" onClick={pauseAll} disabled={running === 0}>
    暂停全部
  </button>
  <button className="btn" onClick={retryAllErrored} disabled={errored === 0}>
    <RotateCcw size={11}/>
    重试 {errored} 项
  </button>
</div>
```

- **暂停全部**：遍历活跃任务调 `cancelTask`（后端没有"暂停"语义，按取消处理；如果后端将来加 pause 再升级）
- **重试 N 项**：遍历 FAILED 任务调 `retryTask`

**当前路由高亮**（参考 L293-294 + L314-320）：

- 从 `useLocation` 拿 pathname，正则匹配 `/processing/(.+)` 提取当前 taskId
- 当前 taskId 行：`borderLeft: 2px solid var(--accent)` + `background: var(--bg-sunken)` + 右侧 mono `查看中` pill（红边框红字）

**commit**：`feat(phase-r10): R10.5 footer 批量暂停/重试 + 当前路由任务高亮`

---

## 子任务顺序

⚠️ **必须 R10.0 优先做**，因为 R10.1~R10.5 需要真实任务跑起来做 e2e 验收。

```
R10.0 (hotfix audio platform URL)  ← 阻塞，先做
  ↓
R10.1 (视觉骨架对齐 p1_features.jsx + stage 名)
  ↓
R10.2 (取消按钮 — 用户加项)
  ↓
R10.3 (重试按钮 — Remix 内联位置)
  ↓
R10.4 (隐藏已终结 + FAILED 本地隐藏)
  ↓
R10.5 (footer 批量 + 当前路由高亮)
```

每步独立 commit，做完跑：
- 后端：`.venv/bin/python -m pytest tests/backend -q`
- 前端：`cd frontend && pnpm lint && pnpm build && pnpm test --run`

---

## 禁止事项

- ❌ 不改 sniff_url 逻辑（已 R7.2 验证过的，不要碰）
- ❌ 不改 PreflightDrawer / AddMaterialModal（R8 边界）
- ❌ 不删后端 task 记录（R10.4 决议）
- ❌ 不写 hardcoded color/px，全走 `var(--*)` token
- ❌ 不 push 远端
- ❌ 不自动 merge，6 个 commit 完成停下等用户

---

## 验收清单

1. 后端 pytest 全过（含新增 `test_audio_task_platform_url.py`）
2. 前端 lint + build + test 全过
3. 手测：粘贴 B 站短视频 → 一键解析 → video + audio 两个任务都跑通；popover 列表显示两条，各自有 stage 名和取消按钮
4. 手测：取消进行中任务 → 任务 → CANCELLED → 从 popover 消失
5. 手测：mock 失败一个任务 → 显示重试按钮 → 点重试任务重新跑
6. 手测：YouTube / 抖音短视频 audio 任务也能跑通（验证 R10.0 覆盖面）
