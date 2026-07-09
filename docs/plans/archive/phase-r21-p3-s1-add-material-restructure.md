---
phase: R21.P3.S1
title: AddMaterialModal 重构 —— 拆「采集参数」/ 视频用途模式 / 链接预填背景
status: done
owner: 待定（建议 Opus，涉及前端结构性改动 + 后端新增 link-preview）
estimated_hours: 6-9
depends_on:
  - r21-p2-revisions-v3（已 merge）
user_source: 2026-05-28 用户第三轮反馈（结果导向重构）
---

## 用户反馈（原话提炼）

> 「前面应该先分选择如何切视频是多帧还是什么，音频是怎么分析等等。总结模板和背景信息这些内容应该是在做完转录或者分析完图片后，在基于前面的内容选择性的进行制作。」

核心改造：把**采集决策**（不可逆、影响 ASR/VLM 调用）和**后处理决策**（可重复、影响 LLM 总结）拆开两个时机。本 phase 只做**前置**的「添加素材页」重构，后处理放 S2。

## 改造目标

### 1. AddMaterialModal 字段重组

**移除**：
- ❌ 总结模板（简洁摘要 / 详细要点 / 9 种模板）→ 移到结果页 S2
- ❌ 「背景信息」单字段 → 拆成两份，前置版（识别用）保留，总结用版移到 S2

**保留 + 重命名**：
- 「背景信息」→ 「**识别用背景**」（喂给 ASR/VLM 提升专有名词识别）

**新增**：
- **视频用途模式**（视频素材必选，互斥单选）：
  - 📖 学习/课程模式：以转录为主轴，画面按需补图（关键帧 + 转录主导）
  - 🎨 复刻/创作模式：每帧 VLM 描述 + 提示词（画面主导）
  - 子参数随模式变（见下）
- **图片采集模式**（图片素材必选，互斥单选）：
  - 提示词复刻：VLM 生成图生图提示词
  - OCR 识别：提取图中文字
  - 注：图文混合（小红书类）「识别用背景」字段仍保留

### 2. 按素材类型差异化展示

| 素材类型 | 是否显示采集参数页 | 关键字段 |
|---|---|---|
| 文字（粘贴/txt/md） | ❌ 跳过，直接进结果页 | — |
| 图片 | ✅ | 图片采集模式（必选）/ 识别用背景（选填） |
| 音频 | ✅ | ASR / 音乐分析 / 说话人区分 / 识别用背景 |
| 视频 | ✅ | 视频用途模式 + 子参数 / 识别用背景 |

视频子参数根据用途模式动态：
- **学习模式**：ASR 必开（灰禁） / 说话人区分 / 音乐分析（选填）
- **复刻模式**：切帧策略（AI 镜头 / 按秒，原有逻辑保留）/ 每镜头取几帧 / ASR 开关（选填）

### 3. 链接素材 og 预填（C3 决定）

后端新增 `GET /api/link-preview?url=<encoded>`：
- 抓取 HTML 的 `<meta property="og:title">` / `og:description` / `og:image`
- B 站 BV 链接走专用解析（已有逻辑可复用，看 `backend/app/services/` 下是否有 bili 解析器；没有则用通用 og）
- 返回 `{ title, description, image_url, source: "bili" | "og" | "fallback" }`
- 前端拿到后**预填到「识别用背景」**字段（用户可改，可清空）
- 超时 5s，失败静默（不阻塞用户输入）

## 文件改动清单（估算）

| 文件 | 改动 |
|---|---|
| `frontend/src/components/workspace/AddMaterialModal.tsx` | 大改：字段重组 + 视频用途模式 + 图片采集模式 + 链接预填调用 |
| `frontend/src/lib/featuresToSteps.ts` | 增 `videoIntent: 'learning' \| 'replica'` 字段 → steps 映射调整 |
| `frontend/src/lib/preflightTasks.ts` | `applyCascades` 接收 videoIntent，学习模式默认不勾每帧 VLM |
| `frontend/src/services/linkPreview.ts` | 新增前端 fetcher |
| `frontend/src/__tests__/AddMaterialModal.test.tsx` | 增 4 个用例：视频学习/复刻切换 / 图片模式切换 / 文字跳过参数页 / 链接预填回填 |
| `backend/app/routes/link_preview.py` | 新文件：og 抓取 endpoint |
| `backend/app/main.py` | 注册 link_preview router |
| `backend/tests/test_link_preview.py` | 新增：mock requests 测三种 source |

## 实施步骤

### Step 1：后端 link-preview endpoint（独立，可并行）

1. 新建 `backend/app/routes/link_preview.py`：
   - `GET /api/link-preview?url=<encoded>`
   - 用 `httpx.AsyncClient(timeout=5)` 抓 HTML
   - 用 `beautifulsoup4`（确认已在 requirements；没有则停下问用户是否新增依赖）解析 og:* 标签
   - B 站 URL 模式（`bilibili.com/video/BV...`）若仓库已有 bili 解析器（grep `bilibili` 看），优先用；否则走通用 og
2. 注册 router
3. 写 `backend/tests/test_link_preview.py`：mock httpx 测 og / bili / fallback 三种路径
4. `pytest backend/tests/test_link_preview.py` 必须通过

### Step 2：前端字段重组（最大块）

1. AddMaterialModal 顶部按 `sniff().kind` 分支：
   - `text` → 不显示采集参数区，直接「下一步」进结果页
   - `image` → 显示「图片采集模式」二选一 + 识别用背景
   - `audio` → 显示音频参数（保留现有 ASR / 音乐分析 / 说话人）+ 识别用背景
   - `video` → 显示视频用途模式（学习/复刻互斥）+ 模式相关子参数 + 识别用背景
2. 移除「总结模板」「背景信息（总结用）」UI 与 state（这些字段在 S2 重新引入到结果页）
3. 字段命名统一：`backgroundForRecognition`（前置）vs `backgroundForSummary`（S2 加）
4. submit 时 payload 增加 `videoIntent`（学习/复刻）和 `imageMode`（复刻/OCR）
5. 后端 `pipeline_tasks` 接收新字段，学习模式跳过每帧 VLM（具体怎么跳 S2 再细化，本期先在 payload 透传 + log）

### Step 3：链接预填集成

1. URL 框 onBlur（或 paste 后 300ms debounce）触发 `GET /api/link-preview`
2. 成功且「识别用背景」**为空**时回填 `${title}\n\n${description}`
3. 字段已有内容则不覆盖；用户可手动按「重新抓取」按钮覆盖
4. 显示 source 来源 hint：「已自动从 B 站抓取」/「已自动从网页抓取」

### Step 4：单测 + 端到端自查

1. vitest：AddMaterialModal 新增 4 用例（见文件清单），全部通过
2. pytest：link_preview 通过
3. 启服务端 + 前端，跑一遍：
   - 粘贴一段文字 → 应直接跳过参数页
   - 上传一张图 → 看到二选一
   - 粘贴 B 站 BV 链接 → 识别用背景自动填入标题简介
   - 选学习模式 → 子参数变化
   - 选复刻模式 → 切帧策略字段出现
4. 截图存到 `docs/plans/r21-p3-s1-verify/`（manual 验证证据）

## 验收标准

- [x] AddMaterialModal 不再出现「总结模板」chip 行
- [x] AddMaterialModal 不再出现「背景信息」字段，取而代之是「识别用背景」
- [x] 文字素材添加时跳过参数页
- [x] 图片素材必须选「复刻 or OCR」其一才能提交
- [x] 视频素材必须选「学习 or 复刻」其一，子参数随之切换
- [x] B 站 / YouTube / 通用网页链接粘贴后能自动预填识别用背景
- [x] 全部新增/改动单测通过
- [x] 后端老 API 兼容：旧前端调用（不带 videoIntent / imageMode）后端走默认（视频→复刻、图片→OCR），不报错

## 不在本期范围（明确推到 S2/S3）

- 结果页「总结」tab
- `item_summaries` 表 + 多版本总结
- 总结对比模式
- 学习模式的「按需补图」交互（用户在转录旁选时间轴帧）
- 数据迁移 `item.summary` → `item_summaries`

## 风险点

1. **后端 schema 不动，但 payload 多字段**：要确认 `payload` 是否落库到 `item.raw_payload` 之类的 jsonb 字段；如需 alembic migration，**停下问用户**（CLAUDE.md §4 第 4 条）
2. **学习模式跳过每帧 VLM 的具体实现**：本期只在 payload 层接受字段，pipeline 层的差异化执行留给 S2（不然 S1 太大）
3. **og 抓取的 CORS / UA / 反爬**：后端代理抓取规避前端 CORS；UA 用桌面 Chrome；失败静默（用户可手填）

## 给 owner 的提示词

执行本 plan 时遵守 [CLAUDE.md](../../CLAUDE.md) §2 沟通规则、§4 红线、§5 子任务颗粒度。Step 1 + Step 2 + Step 3 + Step 4 各自一个 commit。完成后**不要自己合 main**，提醒用户验收后再 merge。

---

## 附录 A：mimo 执行预备信息（2026-05-28 Opus 预扫产物）

### A.1 依赖现状（不用装新东西）

`requirements.txt` 已含：
- `httpx>=0.24.0` —— 异步 HTTP 抓取
- `readability-lxml>=0.8.1` —— 网页正文抽取
- `lxml>=5.0.0` —— HTML 解析 og 标签

**不需要 `pip install` 任何东西。如发现还需新依赖必须停下问用户（CLAUDE.md §4 第 1 条）。**

### A.2 B 站元数据：直接复用已有 downloader

文件：`backend/app/downloaders/bilibili_nocookie.py`

```python
from app.downloaders.bilibili_nocookie import (
    extract_bvid_from_url,        # 从 URL 抽 BV 号，非 B 站返回 None
    BilibiliNoCookieDownloader,   # 含 .get_meta(url) -> VideoMeta（标题/简介/封面）
)
```

**B 站链接直接走 `get_meta()`，不要重新写一遍 BV 解析。** 通用网页才走 og 抓取。

### A.3 后端 router 注册位置

- 新建文件：`backend/app/routes/link_preview.py`
- 在 [backend/app/main.py:124](backend/app/main.py:124) 之后加 `app.include_router(link_preview_router)`
- 路由前缀照同目录其他 router 风格（看 providers.py / templates.py 是怎么定义 router prefix 的）

### A.4 ⚠️ payload 字段挂载位置（容易搞错）

后端 pipeline payload 已有嵌套结构 `payload.preflight.{ocr, assoc, prompt, frame_prompt}`（看 [pipeline_tasks.py:1196](backend/app/services/pipeline_tasks.py:1196) 和 [pipeline_tasks.py:1899](backend/app/services/pipeline_tasks.py:1899)）。

**新增字段必须挂在 `payload.preflight` 下：**
```json
{
  "preflight": {
    "intent": "learning" | "replica",          // 视频用途模式（仅 video 素材有）
    "image_mode": "replica_prompt" | "ocr",    // 图片采集模式（仅 image 素材有）
    "background_for_recognition": "..."        // 识别用背景（统一字段）
  }
}
```

**不要平铺到 payload 顶层。** 后端读时 `payload.get("preflight", {}).get("intent")`。

### A.5 items 相关 API 在 workspaces.py 不是 items.py

backend 没有独立的 `items.py` 路由文件，item CRUD 都在 `backend/app/routes/workspaces.py`。S1 本期不动 item API，只新增 `link_preview.py`，注意别误改。

### A.6 mimo 执行边界（必须停下问用户的情况）

除 CLAUDE.md §4 6 种通用情况外，**本 phase 额外**：
1. 如果发现 `payload.preflight` 老字段（`ocr`/`assoc`/`frame_prompt` 等）与新字段（`intent`/`image_mode`）有命名冲突或语义重叠
2. 如果 AddMaterialModal 现有 state 结构太复杂、直接重构会破坏现有功能（音乐分析、说话人区分等），考虑分两次 commit（先移除再新增）
3. 如果链接预填的 debounce 时机和现有 sniff() 逻辑冲突
4. 如果发现需要修改 `pipeline_tasks.py` 里学习/复刻模式的实际执行逻辑（**本期只透传 + log，不动执行**；真要动留给 S2）
