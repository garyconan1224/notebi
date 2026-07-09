# 图文笔记编辑器升级 · 图文 wysiwyg 改 Milkdown 可编辑（2026-06-22）

> 来源：② 结果页编辑器 7b 的根治。调研发现图文 wysiwyg 是**只读 ReadView**、md格式(NoteEditor)
> 是图文**唯一编辑入口**，故 ② 第一批（`8301add`）只删了视频 md格式。本计划把图文 wysiwyg 升级
> 为 Milkdown 可编辑，让图文也能删 md格式，图文/视频编辑体验统一。

---

## 一、现状（`8301add` 之后）
- `noteContent`（`index.tsx:901-911`）：
  - `compare` → `CompareView`
  - **图文**：`wysiwyg=ReadView`(只读) / `edit=NoteEditor`(源码)
  - **视频**：非 compare 一律 `MilkdownEditor`（已含 edit 残留 fallback）
- 图文中列 tab（`:1342`）：仍是 `['wysiwyg','edit']`。
- `MilkdownEditor`：支持图片节点（`:78-87`），但 `.note-milkdown` **无图片 CSS 样式**。
- `ReadView`（`:258-289`）：**仅 `:906` 一处引用**。

## 二、可行性（已确认）
- `MilkdownEditor`（commonmark+gfm）带 image 节点 + 插入逻辑，能渲染/编辑图片。
- 图文保存**无特殊分支**：`isImageNote` 只用于渲染（`:903 / :1281`），不进 `handleEditorChange / putItemNote`
  → 图文换 Milkdown 后保存逻辑复用视频的，已就绪。

## 三、方案
1. **noteContent**（`:901-911`）：图文 wysiwyg `ReadView` → `MilkdownEditor`。
   升级后图文/视频非 compare 都用 Milkdown，**去掉 isImageNote 分叉**，简化为：
   ```tsx
   {viewMode === 'compare'
     ? <CompareView markdown={editingBody} onMarkdownChange={handleEditorChange} sourceMd={note.source_md} onSeek={handleSeek} />
     : <MilkdownEditor key={milkdownKey} markdown={editingBody} onMarkdownChange={handleEditorChange} onSeek={handleSeek} />}
   ```
2. **图文中列 tab**（`:1342`）：`['wysiwyg','edit']` → 去 `edit`，仿视频 `8301add` 做法
   （去 tab 切换栏 + `viewMode==='edit'` 残留态 fallback 到 Milkdown，已由方案 1 覆盖）。
3. **Milkdown 图片 CSS**：在 `MilkdownEditor.tsx` 的 `.note-milkdown <style>`（`:113-163`）补图片样式，
   仿 `ReadView`（`:272-282`）：`max-width:100%; display:block; margin:16px auto; border-radius:6px`。
4. **清理**：升级后 `ReadView`（`:258-289`）无引用 → 删；`rg` 确认 `NoteEditor`（视频/图文 edit 都删后）
   是否还有引用，无则一并删。

## 四、涉及文件
- `frontend/src/pages/result/NoteShell/index.tsx`（noteContent + 图文 tab + 删 ReadView/NoteEditor）
- `frontend/src/pages/result/NoteShell/MilkdownEditor.tsx`（补图片 CSS）
- 关联测试 `frontend/src/__tests__/NoteShell*.test.*`

## 五、验收
- 图文笔记结果页：**所见即所得 Milkdown 可编辑**、图片正常显示（样式不塌）、编辑能保存（刷新仍在）。
- 图文**无 md格式 tab**（和视频一致）；对照(compare)仍可用。
- 图集（连续多图）渲染正常。
- `npm test`（NoteShell 相关）+ `npm run build` 全绿。

## 六、给小米的红线
- 删 `ReadView`/`NoteEditor` 前 `rg` 全仓确认无其它引用。
- **图集/特殊 markdown 必须实跑验证** Milkdown 渲染（别只看代码猜）。
- 图文保存路径实跑确认（编辑 → 自动保存 → 刷新仍在）。
- 不动总结/版本/对照重组（10/11/12，不在本批）。
- 不 git push；干净 worktree 核对 commit；UI 改动 `./dev.sh` 实跑。
