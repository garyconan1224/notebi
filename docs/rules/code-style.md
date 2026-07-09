# 代码风格 / UI 设计规范 / 测试要求

> 本文件由 `CLAUDE.md` §7 索引指向。AI 用 `rg -n "^##" docs/rules/code-style.md` 查目录后再 `sed -n` 读片段。

---

## 1. 后端（Python）

- 严格遵循 PEP 8。
- 所有函数必须带类型注解（`def foo(x: int) -> str`）。
- public 函数必须带 docstring（一行也行，但要有）。
- 异常用自定义类 + 全局 exception handler，**不要在路由里直接 try/except**。

---

## 2. 前端（TypeScript / React）

- 严格 TypeScript，**禁止使用 `any`**。
- 组件文件 PascalCase（`TaskCard.tsx`），hook 用 `useXxx`。
- 错误用 toast 提示用户，**不用 `alert()`**。

---

## 3. 前端 UI 与设计规范（Nibi 版 · 唯一真相源）

> **铁律：写任何 UI 之前先读 [`docs/DESIGN_TOKENS.md`](../DESIGN_TOKENS.md)。**
> 当前 token 和通用 class 以 `frontend/src/styles/nibi-tokens.css`、`frontend/src/styles/nibi-components.css` 为准。
> `docs/design/` 是旧设计快照，只在追溯历史交互时参考。

### 3.1 3 个权威路径（按使用频率）

| 想做什么 | 看哪 |
|---|---|
| 写新 UI 前查 token / class 词典 | [`docs/DESIGN_TOKENS.md`](../DESIGN_TOKENS.md) ⭐ |
| 看当前 token | `frontend/src/styles/nibi-tokens.css` |
| 看通用 class | `frontend/src/styles/nibi-components.css` |
| 看历史页面快照 | `docs/design/check/*.png` |
| 查业务规则 / 状态机 / 级联 | `docs/rules/business-contract.md` |

### 3.2 5 条不可破铁律

详见 `docs/DESIGN_TOKENS.md §8`：

1. **颜色 / 边框 / 圆角 / 阴影必须用 token**，禁止 hex / rgba / px 边框值（已命名常量例外，如 `99px` 胶囊）。
2. **按业务语义选 accent**：音频→绿 `--accent-green`、视频→紫 `--accent-2`、图片→蓝 `--accent-3`、决策/确认→橙 `--accent-warm`、错误/输入输出→粉 `--accent`。不要按"哪个好看"挑。
3. **modal 用 Remix 结构**：`modal-backdrop` + `modal` + `m-head/body/section/foot`，**不要套 shadcn `<Dialog>` 默认样式**（无障碍底座可保留，可见结构走 Remix class）。
4. **写新组件先 grep `docs/design/components/`**：19 个 jsx 几乎覆盖所有页面。有现成的 → 1:1 复刻；无 → 找最近似的 class 词汇沿用，**不要造新词**。
5. **新 class 命名跟现有体例**：组件前缀（`pf-` / `pp-` / `mat-` / `m-`）+ 部位词。不混 BEM / camelCase。

### 3.3 设计稿同步

用户拿到 Remix 新版本时，按 `docs/DESIGN_TOKENS.md §10` 的 rsync 命令一次性同步到 `docs/design/`，并人工 review `DESIGN_TOKENS.md` 是否需要补 token / class。

---

## 4. 通用代码风格

- **单文件不超过 200 行**，超过就拆分。
- 不要写注释解释"代码在做什么"（让代码本身可读）。**注释只用于解释"为什么这么做"**。

---

## 5. 测试要求

### 5.1 后端测试

- 每个 API 端点必须有至少 1 个 pytest 测试：
  - happy path 测一次
  - 一个常见错误情况（404 / 422）测一次

### 5.2 前端测试

前端组件不强制写单测，但**关键交互必须手动跑一遍并给出结构化证据**：

- 删除/重置等不可逆操作
- 表单校验
- 异步状态切换（loading / 成功 / 失败）

**输出格式**：优先输出 Playwright/`scripts/browser_smoke.py` 的 JSON 结果（URL、DOM 数量、console error、按钮/状态文本）。截图可以保存并报告路径；**只有视觉问题才读取截图内容**。

### 5.3 手动冒烟测试 URL 清单

`docs/test-urls.md` —— 覆盖 Bilibili / YouTube / 小红书 / 抖音 / 微信公众号 / 本地文件，共 10 条，验证 pipeline 和结果展示时直接用。
