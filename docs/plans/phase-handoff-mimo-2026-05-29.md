---
name: phase-handoff-mimo-2026-05-29
title: mimo 接力执行计划 — 清理 A/B/C + 音视频闭环（N7b Gemini 骨架 / N8b / R20）
status: ready
owner: xiaomi mimo 2.5pro（ccswitch 中转）
estimated_hours: 23-33（建议拆 6 个独立 phase，每 phase 一个分支 + 多 commit）
depends_on:
  - main HEAD = `be6edc5`（mimo 切换 + onboarding 已 commit）
  - R21.P3.S3 followup 已合 main
  - 用户 2026-05-29 决议：音视频端到端打通优先
created_date: 2026-05-29
references:
  - docs/rules/mimo-onboarding.md（启动必读）
  - docs/rules/model-strategy.md（模型档位）
  - docs/ROADMAP.md §11（推荐执行顺序）
  - docs/EXECUTION_PLAN.md（进度对账）
  - docs/AI_CODE_INDEX.md（低 token 入口索引）
---

# mimo 接力执行计划（2026-05-29 起）

> 本文件是给 **xiaomi mimo 2.5pro**（CC 终端默认执行者，ccswitch 中转）的可执行任务单。**严格按步骤做**，每步都有「改哪、为什么、验收、commit 模板」。
>
> 计划包含 6 个 Step，**建议每个 Step 一个新分支**，做完 merge 进 main 后再开下一个。一个会话只做一个 Step，**做完停下来提醒用户开新会话**。

---

## 0. 启动 60 秒（每次新会话第一动作）

**必读** [`docs/rules/mimo-onboarding.md`](../rules/mimo-onboarding.md)。简版：

```bash
git status --short --branch && git log --oneline -10
sed -n '1,30p' docs/AI_HANDOFF.md
sed -n '1,40p' docs/EXECUTION_PLAN.md
# 然后打开本文件确认当前 Step
```

**绝对红线**（重复 CLAUDE.md §4，违反会出事故）：

- ❌ `git push origin` / `git reset --hard` / `rm -rf` / `git clean -fd`
- ❌ amend / rebase 主线 commit
- ❌ 装新依赖（pip install / npm install 新包）
- ❌ 改 `.env` / `.env.example`
- ❌ 在 `docs/archive/` / `docs/conversation-inputs/` 里搜索（DEPRECATED）

**遇到与本计划描述不符**（行号漂移、字段名不同、关键字找不到）→ **停下来报告，按 CLAUDE.md §4 风险求证模板问用户**，不要自作主张换方案。

---

## 1. 用户当前决议（2026-05-29）

- 音频 + 视频两条线从输入链接 → 任务 → 落地页**完整端到端打通**，再做文字 / 图片深化
- N7b 路径3 视频大模型选 **Gemini**，但**目前没 API**，本期做"代码骨架 + 接口预留 + 单测 mock"，API 到位后再介入真实测试
- 性能优化 R22 / R23、AI 导演 [C]、开源 [D] 都往后排
- 设计稿已同步到 `docs/design/`（含 scraps + uploads 共 5 份新设计 markdown），**后续会用 Claude Design 定期更新**

---

## 2. Step 总览

> 🔴 **2026-05-29 插队 S0**：mimo 跑 E2E 测试发现 7 个问题（2 P1 数据串扰 + 1 P2 + 4 P3）。**S0 必须先于 S1-S6 执行**，详细 plan：[`phase-e2e-bugfix-2026-05-29.md`](phase-e2e-bugfix-2026-05-29.md)。原因：S4 N7b Gemini 骨架要建立在「真实数据正确返回到结果页」基础上，否则等于在 demo fixture 上加新功能。

| Step | 主题 | 工时 | 依赖 | 推荐分支 |
|---|---|---|---|---|
| **S0** | **E2E bugfix（P1 demo fixture 兜底过宽 + P2/P3）** | **6-8h** | E2E 报告已 commit (`267d426`) | 见 e2e-bugfix plan（每问题独立分支） |
| S1 | 清理 A：plans 老 done 归档 | ~1h | S0 完成 | `chore/cleanup-plans-archive` |
| S2 | 清理 B：旧 Streamlit 入口冻结标记 | 1-2h | — | `chore/cleanup-streamlit-frozen` |
| S3 | 清理 C：未用 assets / 实验代码 | 1-2h | — | `chore/cleanup-unused-assets` |
| S4 | N7b 路径3 Gemini 后端骨架（无 API） | 6-8h | — | `feat/phase-n7b-path3-gemini-skeleton` |
| S5 | N8b 音频 librosa 6 维度后端 | 6-8h | — | `feat/phase-n8b-librosa-6dim` |
| S6 | R20 笔记 PDF/Word/Obsidian 导出 | 8-12h | R19 ✅ | `feat/phase-r20-notes-export` |

**执行顺序建议**：S1 → S2 → S3（清理先做，把仓库整齐）→ S4 或 S5（哪个用户更急做哪个）→ S6。S4/S5 可并行做（前提是不同会话不同 mimo session）。

---

## 3. Step 1：清理 A — plans 老 done 归档

### 目标

把 `docs/plans/` 里 `status: done` 且已 merge 入 main 很久的 phase md 归档到 `docs/plans/archive/`，让 plans 目录只留"近期相关"的计划。**只移动不删除**，可回溯。

### 操作

```bash
git checkout main && git pull --ff-only origin main 2>/dev/null || true
git checkout -b chore/cleanup-plans-archive
mkdir -p docs/plans/archive
```

**归档清单**（status=done 且早于 R20 的）：

```
docs/plans/archive/phase-r-input-refactor.md        # R0~R6
docs/plans/archive/phase-r7-input-flow-unify.md
docs/plans/archive/phase-r8-preflight-remix-replica.md
docs/plans/archive/phase-r9-floating-task-queue.md
docs/plans/archive/phase-r10-hotfix-and-queue-v2.md
docs/plans/archive/phase-r12-processing-page-replica.md
docs/plans/archive/phase-r13-processing-metadata-followup.md
docs/plans/archive/phase-r13.6-metadata-coverage-hotfix.md
docs/plans/archive/phase-r14-multi-type-dedup-ux.md
docs/plans/archive/phase-h1-workbench.md
docs/plans/archive/phase-h2-taskboard.md
docs/plans/archive/phase-h3-processing.md
docs/plans/archive/phase-h4-results.md
docs/plans/archive/phase-h5-storyboard.md
docs/plans/archive/phase-ip7-preflight-fix.md
docs/plans/archive/phase-ip8-connection-audit.md
docs/plans/archive/phase-ip9-flow-gaps.md
docs/plans/archive/phase-integration-pass.md
docs/plans/archive/phase-n1b-workspace-layout.md
docs/plans/archive/phase-n5-preflight.md
docs/plans/archive/phase-n6-task-chat.md
docs/plans/archive/phase-n7-video-branch.md
docs/plans/archive/phase-n8-audio-branch.md
docs/plans/archive/phase-n10-text-branch.md
docs/plans/archive/phase-l-library.md
docs/plans/archive/phase-l5-library-remix-polish.md
docs/plans/archive/phase-f2-smoke.md
docs/plans/archive/phase-f4-content-sniff.md
docs/plans/archive/phase-v3-video-templates.md
docs/plans/archive/phase-r17-add-material-scope-features.md
docs/plans/archive/phase-r18-preflight-drawer-templates.md
docs/plans/archive/phase-r18.1-local-asr-and-failure-popup.md
docs/plans/archive/phase-r19-av-synthesis-notes.md
docs/plans/archive/phase-r21-p2-revisions.md
docs/plans/archive/phase-r21-p2-revisions-v3.md
docs/plans/archive/phase-r21-p3-s1-add-material-restructure.md
docs/plans/archive/phase-r21-p3-s2-summaries-tab-and-table.md
docs/plans/archive/phase-r21-p3-s3-compare-and-learning-mode.md
docs/plans/archive/phase-r21-p3-s3-followup.md
docs/plans/archive/phase-r21-status-sync-bugfix.md
```

**保留**（pending / 当前相关）：
- `phase-a2-speaker-edit.md`（A2 仍未做）
- `phase-r22-parallel-pipeline.md`（pending）
- `phase-r23-perf-tier-settings.md`（pending）
- `phase-handoff-mimo-2026-05-29.md`（本计划）
- `r21-main-verify/` 目录（验证目录，保留）

**移动操作**（**逐个确认 status=done 后移动**，不要一次 mv 整批）：

```bash
# 示例：先 check 一个
head -5 docs/plans/archive/phase-r12-processing-page-replica.md  # 确认 status: done
git mv docs/plans/archive/phase-r12-processing-page-replica.md docs/plans/archive/

# 全部移完后跑 git status 确认改动
git status --short docs/plans/
```

### 验收

- `ls docs/plans/` 顶层只剩 pending 和 当前 phase 计划（3-5 个文件）
- `ls docs/plans/archive/` 含上面归档清单
- `rg "docs/plans/phase-r12" docs/ -l` 0 命中（除了本计划文件，其余文档没有指向已归档的死链）—— **若命中**，停下来报告，可能要在引用方加 `archive/` 前缀

### Commit

```
chore(cleanup): plans 老 done phase 归档到 docs/plans/archive/

R0~R21 已合入 main 的 phase md 共 39 个移到 archive/，保留 A2 / R22 / R23 /
本 handoff 计划在 plans/ 顶层。仅 git mv，可回溯。
```

---

## 4. Step 2：清理 B — 旧 Streamlit 入口冻结标记

### 目标

CLAUDE.md §1 已说"Streamlit legacy 兼容，新功能不要加"。本 Step 把 Streamlit 入口（`app.py`、`pages/`、`src/vidmirror/ui/`）**加冻结标记**（不删代码，加 README + 文件头注释），避免新 AI 误改。

### 操作

```bash
git checkout main && git checkout -b chore/cleanup-streamlit-frozen
```

1. **`app.py` 顶部加冻结注释**（前 5 行加 docstring）：
   ```python
   """
   ⚠️ FROZEN（2026-05-29）：本 Streamlit 入口仅做 legacy 兼容，新功能不要加到这里。
   新功能走 backend/app/main.py (FastAPI) + frontend/src/ (React + Vite)。
   见 CLAUDE.md §1。
   """
   ```

2. **`pages/` 目录加 README.md**（如不存在）：
   ```markdown
   # ⚠️ FROZEN: Streamlit legacy 页面

   2026-05-29 起本目录冻结，仅维持兼容。新页面写到 `frontend/src/pages/`。
   见 [CLAUDE.md §1](../CLAUDE.md)。
   ```

3. **`src/vidmirror/ui/` 同上**（加 README.md 冻结标记）。

### 验收

- `head -5 app.py` 看到冻结注释
- `cat pages/README.md` 和 `cat src/vidmirror/ui/README.md` 都有冻结标记
- 代码功能不受影响：跑 `python app.py --help` 仍能启动（不要真启动，看 import 不报错即可）

### Commit

```
chore(cleanup): 旧 Streamlit 入口加冻结标记（app.py / pages/ / src/vidmirror/ui/）

按 CLAUDE.md §1，Streamlit legacy 已冻结，仅维持兼容。本次加文件级注释
+ README 提醒，新功能必须走 FastAPI + React 路径，不要回到 Streamlit。
```

---

## 5. Step 3：清理 C — 未用 assets / 实验代码

### 目标

清理 `frontend/public/`、`backend tests/` 等目录下**确认未引用**的静态资源和实验脚本。**逐文件确认**，**有疑问就跳过**。

### 操作

```bash
git checkout main && git checkout -b chore/cleanup-unused-assets
```

**扫描候选**（**只列出，不删**）：

```bash
# 前端 public/ 未引用的图片
for f in frontend/public/*.{png,jpg,svg,gif} 2>/dev/null; do
  name=$(basename "$f")
  if ! rg -q "$name" frontend/src/; then
    echo "候选删除：$f"
  fi
done

# 后端可能的实验脚本
find backend/ -name "*.py.bak" -o -name "*_test.py.old" -o -name "scratch_*.py"

# Streamlit 入口冻结后，可能 pages/ 下有显然废弃的 .ipynb / 测试输出
ls pages/ 2>&1 | grep -E "\.(ipynb|out|tmp)$"
```

**删除前必须**：对每个候选文件，跑 `rg -l "<filename>" .` 全仓搜索引用，**0 命中才删**。1 命中就跳过。

**有疑问**（不确定是否未用）→ 停下来报告候选清单给用户拍板。

### 验收

- `git diff --stat` 看删除文件清单
- 跑 `pnpm build` + `.venv/bin/python -m pytest tests/backend -q` 全绿，确认没误删被引用的资源

### Commit

```
chore(cleanup): 删除 N 个未引用的静态资源 / 实验脚本

每个删除文件均经过 `rg -l` 全仓引用搜索（0 命中）确认未用。
pnpm build + pytest 均绿。
```

---

## 6. Step 4：N7b 路径3 Gemini 后端骨架（无 API 测试）

### 目标

把 `backend/app/services/pipeline_tasks.py:747-748` 的占位 raise 替换为 **Gemini 调用骨架**。**目前没 API**，所以只写：
- handler 函数框架（接收 video file path + intent，返回 summary + transcript-like 结构）
- Gemini client 封装预留（含 API key 读取占位）
- 单测：mock Gemini response，验证流程正确性
- **不真实调 Gemini API**，等用户提供 API key 后再做联调

### 背景速查

```bash
# 当前 N7b 路径3 占位
sed -n '740,760p' backend/app/services/pipeline_tasks.py

# UI 已对接的 video_model 路径
rg -n "video_model" backend/ frontend/src/ | head -10

# 现有 handle_analyze_task 结构（参考整体形态）
sed -n '741,830p' backend/app/services/pipeline_tasks.py
```

### 操作步骤

1. **新建 Gemini client 封装**：`shared/gemini_client.py`
   - `class GeminiVideoClient`，构造时读 `GEMINI_API_KEY`（来自 `.env`，**不要新增 .env 字段，用户后续手动加**）
   - `def analyze_video(self, video_path: Path, intent: str, prompt_template: str) -> GeminiVideoResponse`
   - **未设置 API key 时**：`raise RuntimeError("GEMINI_API_KEY 未配置，video_model 路径暂不可用，请在 .env 添加后重试")`
   - **Response dataclass**：`GeminiVideoResponse(summary: str, segments: list[dict], raw_response: dict)`

2. **修 `backend/app/services/pipeline_tasks.py:747-748`**：
   ```python
   if summary_path == "video_model":
       # 调 Gemini 直接分析视频
       from shared.gemini_client import GeminiVideoClient, GeminiVideoResponse
       client = GeminiVideoClient()  # 缺 key 时这里就会 raise，错误信息提示用户加 .env
       response = client.analyze_video(
           video_path=video_path,
           intent=intent,
           prompt_template=_get_video_model_prompt(intent),
       )
       # 映射到 result schema（与现有 av_combined / subtitle 路径返回结构对齐）
       result = {
           "summary": response.summary,
           "transcript": _gemini_segments_to_transcript(response.segments),
           "frames": [],  # video_model 路径不抽帧
           "intent": intent,
           "summary_path": "video_model",
       }
       return result
   ```

3. **新增 prompt template 函数** `_get_video_model_prompt(intent)`：
   - intent="learning" → 学习模式提示词（参考现有 `summary_templates.py` 的 lecture 模板）
   - intent="replica" → 复刻模式提示词
   - 默认 → 通用 prompt

4. **单测**（`tests/backend/test_n7b_path3_gemini_skeleton.py` 新建）：
   - mock `GeminiVideoClient.analyze_video` 返回固定 fixture
   - 验证 `handle_analyze_task` 对 `summary_path="video_model"` 调用正确传参
   - 验证返回 result 结构包含 `summary` / `transcript` / `intent` 字段
   - 验证缺 GEMINI_API_KEY 时 raise 明确错误（用户能看懂"去 .env 加 GEMINI_API_KEY"）

5. **文档**：在 `docs/spec/04-pipeline-tasks.md`（或对应模块）加一行："video_model 路径已骨架就绪，等待 GEMINI_API_KEY 配置"。

### 验收

- `.venv/bin/python -m pytest tests/backend/test_n7b_path3_gemini_skeleton.py -v` 全绿
- 启动后端，从前端跑 `summary_path=video_model` 任务（学习模式），应 FAILED 状态附明确错误"GEMINI_API_KEY 未配置"（**不再是占位 raise**）
- 跑全套：`pytest tests/backend -q` 全绿，**不增加新依赖**

### Commit 颗粒度（建议 4 个 commit）

```
1. feat(n7b.s4): Gemini client 封装骨架（shared/gemini_client.py）
2. feat(n7b.s4): pipeline_tasks video_model 路径接 Gemini client
3. test(n7b.s4): N7b 路径3 单测（mock Gemini response）
4. docs(n7b.s4): 更新 spec 标注 video_model 骨架就绪
```

---

## 7. Step 5：N8b 音频 librosa 6 维度后端

> **【2026-05-29 作废】** N8b 6 维度实际已由 A3.3 完整实现（MusicSegment genre/mood/instruments/atmosphere + segment_audio + AudioResultPage:557）。本节原计划基于未核实假设（onset_density/tempo_variance/style_label），与实际 6 维完全不同，不执行。本次 S5 仅修 result→UI 的 `music_segments` 映射断裂（pipeline 返回 `music.segments`，前端读顶层 `music_segments`）。

### 目标

`shared/audio_analyzer.py:195` 已有基础 `analyze_music`（librosa BPM / 调性 / 能量曲线）。本 Step 扩展为 **6 维度切分**：
1. BPM（已有）
2. 调性 Key（已有）
3. 能量曲线 Energy（已有）
4. **新增**：节奏稳定性（onset density / tempo variance）
5. **新增**：段落切分（基于能量突变检测段间边界）
6. **新增**：风格分类（major/minor + tempo bracket → quick label：ballad / dance / lo-fi / etc.）

### 背景速查

```bash
sed -n '195,260p' shared/audio_analyzer.py
rg -n "MusicAnalysis|analyze_music" backend/ frontend/src/types/
```

### 操作步骤

1. **扩展 `MusicAnalysis` dataclass**（`shared/audio_analyzer.py:72-95` 附近）：
   ```python
   @dataclass
   class MusicAnalysis:
       bpm: float | None
       key: str | None
       energy_curve: list[float] | None
       # 新增
       onset_density: float | None       # onsets per second
       tempo_variance: float | None      # std of local BPM
       segments: list[MusicSegment]      # 段落切分
       style_label: str | None           # quick 风格分类
   ```

2. **新增 `MusicSegment` dataclass**：
   ```python
   @dataclass
   class MusicSegment:
       start_sec: float
       end_sec: float
       energy_avg: float
       label: str  # intro/verse/chorus/bridge/outro/unknown
   ```

3. **扩展 `analyze_music` 函数**：实现 4/5/6 维度。librosa 已能跑 onset / segment / tempo variance，参考：
   - `librosa.onset.onset_detect` → onset density
   - `librosa.segment.agglomerative` → 段落边界
   - `np.std(librosa.beat.tempo)` → tempo variance
   - 风格分类：简单规则（`if bpm < 90 and key endswith "m"`：lo-fi；`if bpm > 120 and key endswith "":dance`...）

4. **前端类型同步**：`frontend/src/types/result.ts`（或对应 AudioResult 类型）加 6 维字段。

5. **AudioResultPage 渲染**：UI 已有 N8b 区块（IP.9.2），mimo 需确认是否已绑定新字段。**如果 UI 已就绪只缺数据 → 这一步 0 改动**，UI 自动拿到新字段。

6. **单测**：`tests/backend/test_audio_6dim.py`，用 fixture 音频文件（找一个 < 1MB 的小 wav），验证 6 个字段都非 None。

### 验收

- `pytest tests/backend/test_audio_6dim.py -v` 全绿
- 启动后端 + 前端，跑一个真实音频任务（建议短 mp3），看 AudioResultPage 显示 6 维度信息（**用户帮看 UI**）
- `pytest tests/backend -q` 全绿

### Commit 颗粒度

```
1. feat(n8b): MusicAnalysis 扩展 6 维度字段 + MusicSegment dataclass
2. feat(n8b): analyze_music 实现 onset / segment / tempo variance / style label
3. feat(n8b): 前端 AudioResult 类型同步 6 维字段（如 UI 已绑定则跳过此步）
4. test(n8b): librosa 6 维度单测 + fixture
```

---

## 8. Step 6：R20 笔记 PDF / Word / Obsidian 导出

### 目标

R19 av_synthesis 已实现 Markdown 导出（`handle_av_synthesis_task` 2586 行）。R20 扩展为 3 个新格式：PDF / Word / Obsidian vault。

### 背景速查

```bash
sed -n '2586,2680p' backend/app/services/pipeline_tasks.py  # av_synthesis handler
rg -n "markdown|md_path|export" backend/app/services/pipeline_tasks.py | head -10
```

**已有 skill 可参考**（全局可用）：
- `bilibili-render-pdf`：LaTeX 教学笔记骨架 → PDF
- `bilibili-notes-to-obsidian`：Obsidian vault 结构

### 操作步骤

1. **后端新增 endpoint**：`POST /workspaces/<ws>/items/<item>/notes/export`
   - 请求体：`{format: "pdf" | "docx" | "obsidian"}`
   - 响应：下载 URL 或 zip 二进制流

2. **PDF 导出**（用 markdown-to-PDF 工具，**不要装新依赖**——优先用项目已有的 `reportlab` 或 `weasyprint`，没有就用 mimo 已知的 skill `bilibili-render-pdf` 参考流程，实在没办法**停下问用户授权装** `weasyprint`）

3. **Word 导出**（`python-docx` 是否已有？跑 `pip list | grep -i docx` 查）

4. **Obsidian 导出**：zip 含 `.md` 文件 + `frames/` 目录 + 关系图（参考 `bilibili-notes-to-obsidian` skill）

5. **前端**：在 NotesResultPage（或 av_synthesis 结果页）加 3 个下载按钮

### 验收

- 用真实 av_synthesis 任务跑 3 种导出，文件能下载、能打开、无乱码
- 单测：mock 导出函数，验证 endpoint 返回 200 + 正确 Content-Type
- pytest 全绿

### Commit 颗粒度

```
1. feat(r20): 后端 notes export endpoint + 格式分发
2. feat(r20): PDF 导出实现（含字体兜底）
3. feat(r20): Word 导出实现
4. feat(r20): Obsidian vault zip 导出
5. feat(r20): 前端 NotesResultPage 加 3 个下载按钮
6. test(r20): export 单测 + fixture
```

---

## 9. 收尾（每个 Step 完成后）

1. **本 Step 全部 commit 后**：
   - 跑 `pytest tests/backend -q` + `pnpm build` 全绿
   - `git checkout main && git merge --no-ff <step-branch> -m "Merge branch '<step-branch>'"` (**本地 merge，不 push**)
2. **文档同步**：
   - `docs/EXECUTION_PLAN.md`：对应 Step 打勾
   - `docs/COMPLETED_WORK.md`：追加一段（格式见文件顶部"记录模板"）
   - `docs/AI_HANDOFF.md`：更新"当前状态" + "立即下一步" 指向下一个 Step
3. **提醒用户**：本 Step 完工，建议开新会话做下一个 Step，并贴出本计划文件路径。

---

## 10. 后续顺序（6 Step 完成后）

按用户 5/29 决议：

```
S1-S3 清理 → S4 N7b 骨架 → S5 N8b → S6 R20
   ↓
T1~T3 文字深化（多文对比 / 网页抓取扩展）
   ↓
I2~I3 图片深化（EXIF / 批量 / 风格 DNA）
   ↓
R22 并行调度 + R23 性能档位（issue 6/9 体验优化）
   ↓
[C] AI 导演大集成（需先补设计稿，Claude Design 更新）
   ↓
[D] 安全 + 开源准备
```

**未来某天 Gemini API 到位**：把 S4 留的 mock 单测替换为真实联调，跑端到端冒烟（学习视频 → Gemini 直接分析 → 落地页），无需新 phase。

---

## 11. mimo 协作快速回顾

- **第一次开会话**：先读 [`docs/rules/mimo-onboarding.md`](../rules/mimo-onboarding.md)，按"启动 60 秒"做对账
- **中文 skill 评估**：**不需要装额外 skill**。CLAUDE.md 已强制中文输出，mimo-onboarding.md 已写全部"更聪明更快更省"协议
- **codegraph MCP**：会话开始时 `still connecting` 几秒后可用。如长时间没 ready，查 MCP 配置（不可用时 fallback 到 `rg`）
- **卡住时**：按 mimo-onboarding §6 fallback 链（rg → codegraph → AI_CODE_INDEX → SPEC → 停下问用户），**不要凭直觉决定**
- **commit 颗粒度**：每个子任务一个 commit，message 格式 `<type>(<phase>): <做了什么>`，结尾带 `Co-Authored-By:`（按仓库现有风格）
- **不要 push origin**（CLAUDE.md §4 红线）—— 所有 merge 都是 local

---

## 附录 A：关键文件 / 行号速查（可能漂移，以关键字为准）

| 作用 | 文件:行 | 关键字 |
|---|---|---|
| N7b 路径3 占位 raise（S4 改） | `backend/app/services/pipeline_tasks.py:747` | `if summary_path == "video_model"` |
| N7b UI 已对接 video_model | `backend/app/routes/workspaces.py:112-113` | `"视频模型直接分析": "video_model"` |
| handle_analyze_task 入口（S4 参考形态） | `backend/app/services/pipeline_tasks.py:741` | `def handle_analyze_task` |
| handle_audio_task 入口（S5 参考） | `backend/app/services/pipeline_tasks.py:2151` | `def handle_audio_task` |
| MusicAnalysis dataclass（S5 改） | `shared/audio_analyzer.py:72` | `class MusicAnalysis` |
| analyze_music 函数（S5 改） | `shared/audio_analyzer.py:195` | `def analyze_music` |
| handle_av_synthesis_task（S6 参考） | `backend/app/services/pipeline_tasks.py:2586` | `def handle_av_synthesis_task` |
| Markdown 导出（S6 参考） | `backend/app/services/pipeline_tasks.py` 同上 | `markdown` / `md_path` |

行号会漂移，**用关键字 + `rg -n` 重新定位**，不要硬记。
