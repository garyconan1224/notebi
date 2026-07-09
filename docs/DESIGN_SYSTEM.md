# Nibi Design System

> 当前 UI 真相源：`frontend/src/styles/nibi-tokens.css`、`frontend/src/styles/nibi-components.css`。
> Open Design 原型来源：`nibi-all-pages.html`。
> 旧 `docs/design/` 是历史快照，只在追溯旧交互时参考，不能作为新页面的视觉事实源。

## 1. 设计基调

Nibi 是本地优先的多媒体内容分析与创作蓝图工具。界面应保持工作台气质：暖中性背景、清晰信息层级、克制动效和高密度但可扫描的布局。

- 主背景使用暖中性 `--bg`，卡片和弹层使用 `--srf`。
- 主强调色使用琥珀橙 `--acc`，不要回退到旧粉紫蓝主调。
- 得意黑只用于品牌、页面标题和重要章节标题。
- 正文、按钮、表格、密集控件使用 Inter / 系统 sans。
- 元信息、状态、URL、时间戳使用 JetBrains Mono。
- 字间距保持 normal 或轻微正 tracking，禁止负 letter-spacing。

## 2. Token

短名 token 是业务代码首选：

| 角色 | Token |
|---|---|
| Display 字体 | `--fd` |
| 正文字体 | `--fb` |
| 等宽字体 | `--fm` |
| 背景 | `--bg`、`--bgalt` |
| 表面 | `--srf` |
| 文字 | `--fg`、`--fg2`、`--mut` |
| 边框 | `--bdr`、`--bdrs` |
| 强调 | `--acc`、`--acch`、`--accl`、`--accfg` |
| 状态 | `--ok`、`--wrn`、`--err` 及对应 light token |
| 圆角 | `--rs`、`--r`、`--rl`、`--rf` |
| 阴影 | `--sh1`、`--sh2`、`--sh3`、`--shf` |

长名 token 保留用于解释语义，例如 `--color-accent`、`--font-display`。
旧 token alias 只作为过渡层存在，例如 `--display`、`--accent-2`、`--bg-elev`，新增代码不要优先使用。

## 3. 组件层

通用类在 `frontend/src/styles/nibi-components.css`：

| Class | 用途 |
|---|---|
| `.display` | 得意黑标题 |
| `.eyebrow` | 小型章节标签和状态眉标 |
| `.mono` | 等宽元信息 |
| `.lede` | 页面说明文案 |
| `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-ghost` | 通用按钮 |
| `.tag` / `.chip` / `.kw` | 标签和关键词 |
| `.input` | 输入框 |
| `.page-header` | 页面标题区 |
| `.nibi-card` | 通用卡片 |
| `.nibi-toolbar` | 工具栏 |

新增页面优先复用这些类。只有页面特有布局才写入对应页面 CSS。

## 4. 迁移规则

- 不再引入旧 token 文件。
- 不新增旧 display 字体、旧粉紫蓝硬编码色值或负字间距。
- 不把页面 section 做成嵌套卡片。卡片只用于重复项目、弹层和明确工具容器。
- 运行态色彩必须来自 Nibi token；报告模板等独立 HTML 可使用 Nibi 色值的静态降级。
- 旧文件、旧包名和兼容环境变量可以保留，但用户可见品牌应使用 Nibi。

## 5. 验收

视觉或品牌迁移提交前至少执行：

```bash
rg -n "旧品牌或旧视觉关键字" frontend/src backend/app/main.py dev.sh start.sh stop.sh
pnpm -C frontend build
pnpm -C frontend test
.venv/bin/pytest tests/backend -q
```
