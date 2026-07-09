---
title: Track K · R4.3 源 md 弹窗渲染图片
status: ready
owner: mimo 执行（Claude 已定方案 + 写好目标代码）
depends_on: R4 §1.4
created: 2026-06-10
---

# Track K · R4.3：源 Markdown 弹窗渲染图片（小改，单文件）

> 📌 给 mimo：只改 1 个文件、2 处，目标代码已写好照抄即可。1 个 commit。

---

## 0. 一句话目标

`SourceMdModal` 现在用 `<pre>` 显示 **raw 源码** → 图片语法 `![]()` 不渲染、用户视觉上「只有文字」。改成用项目**已装的** `react-markdown` 渲染，让图显示出来。

---

## 1. 现状锚点（不用你再查）

- 文件：`frontend/src/pages/result/NoteShell/SourceMdModal.tsx`
- 病因在 **Body（:76–89）**：`<div>...<pre style=...>{sourceMd}</pre></div>` —— 纯文本输出。
- 渲染器现成：`react-markdown` + `remark-gfm` **已是项目依赖**（`HtmlView.tsx`、`StoryboardPage` 在用）→ **不用装新包**。

---

## 2. 改动（只改 `SourceMdModal.tsx` 这一个文件，两处）

### Step 1 · 加 import（文件第 1 行 lucide 那行下面追加两行）

```tsx
import { X, FileCode } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
```

### Step 2 · 替换 Body（把 :76–89 的 `<div>…<pre>…</pre></div>` 整段换成下面）

```tsx
        {/* Body：渲染 markdown，让 ![]() 显示成图（不再是 raw 源码）*/}
        <div
          className="source-md-body"
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '14px 18px',
            fontSize: 13,
            lineHeight: 1.7,
            color: 'var(--ink-2)',
          }}
        >
          <style>{`.source-md-body img { max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 8px 0; }`}</style>
          <ReactMarkdown remarkPlugins={[remarkGfm as any]}>{sourceMd}</ReactMarkdown>
        </div>
```

> 说明：① `remarkGfm as any` 是项目惯例（`StoryboardPage` 也这么写，绕 react-markdown 类型不兼容）；② `<style>` 限制图片宽度，防止大图撑破弹窗；③ 弹窗的遮罩 / Header / Footer **保持原样不动**。

---

## 3. 验证（自己跑，报数字）

```bash
cd /Users/conan/Desktop/nibi/frontend
npx tsc --noEmit   # 期望 EXIT=0
```

- 「图片是否真的渲染出来」属动态 UI → **请用户**打开 NoteShell 点「源 Markdown」弹窗看，你不用截图。

---

## 4. 提交（1 个 commit）

```
feat(k-10.R4.3): 源 md 弹窗用 react-markdown 渲染 — 图片 ![]() 显示成图
```

结尾带仓库现有的 Co-Authored-By 行。**不要 push origin**。

---

## 5. 红线

- ❌ 只改 `SourceMdModal.tsx` 这一个文件，别碰别的。
- ❌ `react-markdown` / `remark-gfm` 已装，**别 npm install**。
- ❌ 别动弹窗的遮罩 / Header / Footer 结构，只换 Body 里的内容渲染。
- ⚠️ 若 `npx tsc --noEmit` 报 `remarkGfm` 类型错 → 确认写了 `as any`（见 §2）；其他报错先 `rg` 确认 import 路径，再不行停下问。
