# 手测 ③组 5/8/9 · 笔记总结体验改造（调研+计划，2026-06-23）

> 来源：手测 19 条 ③组（5 笔记风格过多 / 8 总结模板联动+可编辑 / 9 总结插图）。
> 用户已拍板：**#5 留 6-7 个常用（其余进「更多」）｜ #8 重度完全打通（增删改+重置+多版本）｜ #9 插图扩到更多风格**。

---

## 一、现状（代码实测）

**3 个提示词源并存，没打通：**
1. `frontend/.../AddMaterialModal.tsx:80` `NOTE_STYLE_OPTIONS`：**17 个**风格（标准/精简/详细/金句/大纲/会议/教学/访谈/shownotes/口播/步骤/小红书/长文/问答卡/行动清单/工具推荐/科普）。
2. `backend/app/services/summary_templates.py` `TEMPLATES`：17 风格的**硬编码** `SummaryTemplate`（system_prompt/user_prompt/output_format）。`get_template(id)` 取。**用户改不了。**
3. `shared/template_store.py` `VideoTemplate`：设置「视频模板」，可**增删改/复制**，存 `.local/video_templates.json`，6 视频内置 + 5 文字内置。**无重置、无版本。**

**生成链路**（`pipeline_tasks.py:814`）：读 `payload.summary_template` → `get_template(id)` 拿源 2 的硬编码 prompt。→ **编辑源 3（设置模板）根本不影响风格生成**，这就是「没联动」的根因。

**#9 插图现状**：`summary_generator.py:447` 已有 `embed_frames` 开关 + AI 智能配图（配图原则 prompt + `[[图N]]`），**但只对 `template_id=="standard"` 生效**。

---

## 二、推荐架构（重度统一，交 Codex 复核）

**目标**：让 `template_store` 成为笔记风格的**唯一真相源**，内置风格可编辑/重置/版本，新增即出现在选风格处。

1. **内置风格迁入 template_store（复用现有系统，不新建）**：用户定——**设置「视频模板」直接改名「笔记风格」**，把保留的 7 个内置风格 seed 进 `VideoTemplate`（`is_builtin=True`），prompt 默认值取自 `summary_templates.py`。`VideoTemplate` 增 `desc`/`use_case` 字段（供前端 `?` tooltip），seed 时从 `summary_templates.py` 的同名字段带入。
   - ⚠️ 现有 6 个内置视频模板（教程/Vlog/访谈/影视点评/产品评测/其它，是「内容类型」）与 7 个风格（是「输出样式」）维度不同，统一进「笔记风格」后建议**审一遍是否有重复/冲突**（如「教程」vs「教学笔记/步骤教程」），执行前列清单给用户定去留。
2. **加 `default_prompt`（重置用）**：`VideoTemplate` 增不可变 `default_prompt` 字段（内置风格的出厂 prompt）；`reset_template(id)` → `prompt = default_prompt`。用户自建模板无 default → 不可重置。
3. **加版本栈**：`VideoTemplate` 增 `versions: list[{version, prompt, created_at}]`；存档/列出/回滚（参考现成 `prompt_versions` 版本栈实现，[[workspace_store]] 已有同类）。
4. **生成链路改读 store**：`pipeline_tasks.py:814` 解析 `summary_template` 时，**优先从 template_store 取（用户可能已编辑的 prompt）**，store 没有再回退 `summary_templates.get_template`。
5. **前端选风格读 API**：`NOTE_STYLE_OPTIONS` 改为从 `/templates?category=note` 拉取（保留的内置 + 用户自建），#5 的「6-7 常用 + 更多」用 `is_builtin`/排序实现。

---

## 三、分阶段执行（建议；重度 #8 大，拆批）

### Stage A —— #5 精简 + #9 扩插图（小，快赢，先做）
- **#5**：`NOTE_STYLE_OPTIONS` 精简为 7 个常用（标准/精简/详细/大纲/教学笔记/步骤教程/金句），其余 10 个折叠进「更多」展开区（**纯前端**，不删后端模板）。
- **#5 tooltip**：每个风格旁加 `?` 图标，hover 显示该总结的**适用范围**（文案取 `summary_templates.py` 的 `use_case`/`desc`；前端可先内联一份 id→说明的映射，Stage B 接 API 后改从模板数据读）。
- **#9**：`summary_generator.py:447` 把 `template_id == "standard"` 的插图条件，扩到保留的风格集合（如 `{standard, detailed, lecture, steps}`）。**1 处条件改动**。
- 验收：加素材风格列表只剩 6-7 个 + 「更多」；详细/教学等风格生成也能 `[[图N]]` 插图。

### Stage B —— #8 内置风格可编辑 + 重置（中）
- template_store 加 `default_prompt`；seed 6-7 内置风格；加 `reset_template`。
- 生成链路改为优先读 store 的 prompt。
- 设置页：内置风格可查看/编辑 prompt + 「重置默认」。
- 验收：设置里改某风格 prompt → 生成真的用新 prompt（实跑日志/产物确认）；点重置 → 回出厂 prompt。

### Stage C —— #8 版本栈（中）
- `VideoTemplate` 加 `versions`；存档/列出/回滚 API + 设置页 UI。
- 验收：编辑→存版本→回滚，落盘 `.local/video_templates.json` 正确。

### Stage D —— #8 选风格读 API（统一收口）
- 前端选风格从 `/templates` 拉取；新增设置模板即出现在选风格处。
- 验收：设置加一个新模板 → 加素材选风格处出现 → 选它生成走该 prompt。

---

## 四、涉及文件

**后端**：`shared/template_store.py`（default_prompt/reset/versions）、`backend/app/routes/templates.py`（reset/version 端点 + note category）、`backend/app/services/pipeline_tasks.py:814`（生成改读 store）、`summary_generator.py:447`（#9 扩插图）、`summary_templates.py`（内置 prompt 作为 seed 来源）。
**前端**：`AddMaterialModal.tsx`（#5 精简+更多、Stage D 读 API）、设置 `VideoTemplatesPage.tsx`（编辑/重置/版本 UI）。

---

## 五、验收 / 红线（§6.5）

- **重度 #8 真打通的硬指标**：在设置里改一个内置风格的 prompt → 用该风格生成笔记 → **实跑确认产物用的是改后 prompt**（不是硬编码）。这是 #8「联动」是否真生效的唯一判据。
- `template_store` 加字段 `from_dict` 对旧 `.local/video_templates.json` 兜底（缺 default_prompt/versions 不报错）。
- 内置风格的 `default_prompt` 不可被用户编辑覆盖（重置要能回出厂）。
- 改完前端 `npm run build` 绿（别只信 tsc）；后端相关 pytest。
- 不动 `.env`、一个 commit 一件事、干净 checkout 核对、不主动 push。
- 建议在新分支（如 `feat/summary-styles-589`）做；Stage A 可独立先合。

---

## 六、用户已确认（2026-06-23）

- ✅ **#5 保留 7 个**：标准总结 / 精简摘要 / 详细要点 / 大纲 / 教学笔记 / 步骤教程 / 金句提取；其余 10 个折进「更多」。每个旁加 `?` tooltip 显示适用范围。
- ✅ **#8 不新建系统**：设置「视频模板」**直接改名「笔记风格」**，复用其增删改 + 补重置/版本。

**仍需执行前核一次**：现有 6 个内置视频模板（教程/Vlog/访谈/影视点评/产品评测/其它）并入「笔记风格」后是否与 7 风格重复，列清单给用户定去留（见 §二.1 ⚠️）。
