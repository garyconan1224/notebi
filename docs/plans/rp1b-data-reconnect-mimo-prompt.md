---
phase: RP1-B+ · B 系列数据接入重做（学习笔记页对接真实 pipeline 产物）
status: ready
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-B
companion: 记忆 project_rp1b_data_source_gap（5 层发现链全景）
priority: P0（高于 B-7/B-8——不接对数据，B 系列对真实用户就是空的）
estimated_hours: 8-12（阶段 1-3 读取层适配 4-6h；阶段 4 治本迁移 4-6h）
deps_redline: false（阶段 1-3 无新依赖、不动 pipeline、不迁移数据）
decisions:
  - 解耦：先做"读取层适配"（阶段 1-3，让 /ln 对接现有产物，低风险），pipeline 路径治本 + 存量迁移（阶段 4）放最后。
  - 不改 pipeline 产物命名（保持「图文分镜.md」），读取层去适配；ln.md 仅作用户编辑覆盖层。
---

## 0. 问题全景（mimo 必读 · 为什么要做这个）

RP1-B 学习笔记页（`/ln`）整个建立在一个**真实流程里不存在的数据契约**上。5 层发现链（2026-05-30 测 B-1~B-6 时挖出）：

1. 后端 `GET/PATCH /workspaces/{ws}/ln` 读写 `{ws}/ln.md`。
2. 但真实视频分析 pipeline 产出的笔记叫 **`{json_stem}_图文分镜.md`**（首行 `# 视频拆解：《…》`），存在 **`{视觉数据.json 同级}/{json_stem}_分析报告/`** 目录里。
3. `av_synthesis.md` 是孤儿老数据（28 个，对应 ws 不在 store）；**78 个活跃 ws 几乎都没有任何笔记文件**。
4. 后果：**78 个活跃 ws 访问 `/ln` 全部 404 空白**，只有 1 个手造 ln.md 的测试 ws 能看。
5. B-1~B-6 代码本身都没问题（已逐个测过），但读的 `ln.md` 不存在 → 整个 B 系列对真实数据是空的。

**根因**：RP1-B 规格假设笔记产物叫 `ln.md @ ws`，实际是 `图文分镜.md @ {分析报告目录}`。两者从未对接。

## 1. 技术支点（已确认，方案可行的关键）

后端 **`backend/app/routes/workspaces.py:1568` `_materialize_video_results_from_analyze`** 已经在做"从 analyze 产物读数据"：
- 输入 `results["json_outputs"]`（如 `.../xxx_视觉数据.json` 绝对路径）
- 推导 `json_stem = stem.replace("_视觉数据", "")`
- 定位 `{json_stem}_分析报告/frames/` 读帧（这就是 getItemResult 能拿到 frames/transcript 的原因）

→ **图文分镜.md 就在 `{json_stem}_分析报告/{json_stem}_图文分镜.md`**（和 frames 同父目录）。
→ `/ln` 接入真实笔记 = **复用同一套路径推导**，无需迁移 default_project。

## 2. 设计方案（4 阶段解耦）

| 阶段 | 内容 | 风险 | 依赖 |
|---|---|---|---|
| **1** | `GET /ln` 接入真实笔记（图文分镜.md） | 低 | 复用 §1 推导 |
| **2** | 视频能播：video url 适配产物实际位置 | 低 | 同 §1 |
| **3** | 编辑层：ln.md 覆盖 + 导出对接（解锁 B-7） | 低 | 阶段 1 |
| **4** | 治本：pipeline 产物路径 default_project→真实 ws_id + 迁移存量 | **高**（动 pipeline + 数据迁移） | 独立，放最后 |

阶段 1-3 是"读取层适配"——不动 pipeline、不迁移数据，让 B 系列立即对接现有产物。阶段 4 是架构正确性清理，单独谨慎做。

## 3. mimo 启动提示词 · 阶段 1+2（核心，先做这个解锁 B 系列）

```
RP1-B+ 数据接入重做 · 阶段 1+2：让 /ln 对接真实 pipeline 产物（笔记 + 视频）。
背景必读: docs/plans/rp1b-data-reconnect-mimo-prompt.md §0 §1（为什么 + 技术支点）
实测 ws（有真实 analyze 产物）: 0243af4c-3fec-4e2e-a214-f4dbd31d804b
  它的产物在 data/workspaces/default_project/videos/万物…BV1BVLK6QEW9_分析报告/

【任务 0: 先确认产物定位逻辑 + json_outputs 来源】
  sed -n '1568,1660p' backend/app/routes/workspaces.py   # _materialize 的推导
  rg -n "json_outputs|video_basenames|_materialize_video_results" backend/app/routes/workspaces.py
  确认：video item.results 里 json_outputs 怎么来（analyze task.result）、basename 怎么取。

【任务 1: 抽公共 helper —— 定位「分析报告」目录】
  在 workspaces.py 抽一个：
    def _locate_analyze_report_dir(results: dict) -> Path | None
  逻辑（复用 _materialize 里现成的）：
    json_outputs → 取存在的 视觉数据.json → json_stem = stem.replace("_视觉数据","")
    → 在 [parent, parent.parent/"videos"] 下找 f"{json_stem}_分析报告" 目录，返回它
  把 _materialize 里 frames_dir 那段也改成调用它（避免重复）。

【任务 2: GET /ln 接入真实笔记（backend/app/routes/export.py）】
  改 get_ln_markdown：
    1) 优先 {ws}/ln.md（用户编辑层）—— 存在就用它
    2) 否则：取该 ws 的 video item.results → _locate_analyze_report_dir →
       读 {report_dir}/{json_stem}_图文分镜.md（确切名先 ls 确认：可能是 _图文分镜.md）
    3) 都没有 → 404「学习笔记尚未生成」
  注意 export.py 要能拿到 item.results：参照同文件其它端点怎么取 item / _store。

【任务 3: 视频 url 适配产物位置（workspaces.py video url 解析 ~1752）】
  现在只找 {ws}/videos/。补一路：若 {ws}/videos/ 没有，去 video item 的
  analyze 产物目录（_locate_analyze_report_dir 的父级 videos/ 或 default_project/videos/）
  按 basename 找 {name}.mp4，拼 /static 绝对路径。
  目标：真实 ws 的 video.url 指向能播的本地 mp4（不再兜底 B 站链接）。

【范围（阶段 1+2）】
- 只做"读取层适配"：不动 pipeline_tasks.py、不迁移 default_project 数据、不改产物命名。
- 不做编辑层导出（阶段 3）、不做 pipeline 治本迁移（阶段 4）。
- 不装新依赖。不留 debug 脚本。

【验证】
- pytest（新写：GET /ln 对有 analyze 产物的 ws 返回图文分镜.md 内容）→ 自己跑过
- curl 实测：之前 404 的真实 ws，GET /ln 现在 200 + 返回「# 视频拆解…」
- curl: video result url 对真实 ws 指向 /static 本地 mp4
- pnpm build 不受影响（纯后端）
- 一句话总结，不 push
```

## 4. 后续阶段（阶段 1+2 验证通过后再展开提示词）

### 阶段 3：编辑层 + 导出（解锁 B-7）
- `PATCH /ln` 已写 ln.md（编辑层），无需改。
- `GET /ln` 阶段 1 已"优先 ln.md 兜底图文分镜.md"——编辑层自动成立。
- B-7 导出：`export_notes` 改为"优先 ln.md，兜底图文分镜.md / av_synthesis.md"。
  ⚠️ 图文分镜.md 与 `parse_av_synthesis_md` 的结构契约要先核对（章节名是否匹配）；
  不匹配则导出走"原文直转"（obsidian 直接打包 md；pdf/docx 用通用 markdown 渲染，不强依赖结构 parser）。

### 阶段 4：pipeline 路径治本 + 存量迁移（高风险，单独会话/worktree）
- `pipeline_tasks.py:476` 等多处 `get_workspace_videos_dir(record.project_id)` → 改用真实 workspace_id。
  先确认 task payload / record 能否拿到真实 ws_id（`_bridge_to_pipeline_payload` 是否带）；
  拿不到则需在 create_task 时把 ws_id 透传进 payload。
- 存量迁移：`default_project/videos/*` 按 basename ↔ 各 ws 的 video item 对应，迁回 `{ws}/videos/`。
  写一次性迁移脚本 + dry-run 核对，**改 schema/批量移动文件前停下问用户**（§4 红线）。
- 迁移后阶段 2 的"适配 default_project"兜底可保留（向后兼容老数据）。

## 5. 关键技术参考

```bash
# 产物定位现成逻辑（阶段 1 复用）
sed -n '1568,1660p' backend/app/routes/workspaces.py
# 图文分镜.md 确切文件名
find data/workspaces/default_project/videos -name "*图文分镜*"
# export.py 怎么取 item / _store（GET /ln 要用）
rg -n "_store\.|_find_item|rec\.items|item.results" backend/app/routes/export.py
# video url 解析现状（阶段 2 改这里）
sed -n '1752,1775p' backend/app/routes/workspaces.py
```

## 6. 验收清单（阶段 1+2）

- [ ] `_locate_analyze_report_dir` helper 抽出，_materialize 复用它
- [ ] GET /ln：优先 ln.md → 兜底图文分镜.md → 404
- [ ] 之前 404 的真实 ws，/ln 现在返回真实笔记（curl 实测）
- [ ] video url 对真实 ws 指向 /static 本地 mp4（curl 实测）
- [ ] pytest 新增并通过；纯后端改动，前端 build 不受影响
- [ ] 没动 pipeline / 没迁移数据 / 无新依赖 / 无 debug 脚本
- [ ] COMPLETED_WORK 追加；不 push
```
