# Nibi Token Quick Reference

> 事实源：`frontend/src/styles/nibi-tokens.css`。
> 本文件只做速查，不重复维护完整 CSS。

## 字体

| Token | 字体 | 用途 |
|---|---|---|
| `--fd` | Smiley Sans / Noto Serif SC | 品牌、页面标题、章节标题 |
| `--fb` | Inter / system-ui | 正文、按钮、表单、密集 UI |
| `--fm` | JetBrains Mono / ui-monospace | URL、时间戳、状态、代码 |

## 尺寸

| Token | 值 |
|---|---|
| `--xs` | 11px |
| `--sm` | 13px |
| `--base` | 14px |
| `--lg` | 16px |
| `--xl` | 18px |
| `--2xl` | 24px |
| `--3xl` | 32px |

## 颜色

| Token | 用途 |
|---|---|
| `--bg` | 页面背景 |
| `--bgalt` | 凹陷背景、弱分区 |
| `--srf` | 卡片、弹层、表面 |
| `--fg` | 主文字 |
| `--fg2` | 正文和次级文字 |
| `--mut` | 弱信息、placeholder |
| `--bdr` | 默认边框 |
| `--bdrs` | 强边框和 hover |
| `--acc` | 主强调色 |
| `--acch` | 主强调 hover |
| `--accl` | 主强调浅底 |
| `--ok` | 成功 |
| `--wrn` | 警告 |
| `--err` | 错误 |

## 圆角和阴影

| Token | 用途 |
|---|---|
| `--rs` | 小按钮、chip、kbd、输入内层 |
| `--r` | 常规按钮、输入、紧凑卡片 |
| `--rl` | 大卡片、弹层、页面容器 |
| `--rf` | 胶囊和圆形控件 |
| `--sh1` | 小浮层 |
| `--sh2` | 卡片 hover / 主按钮 |
| `--sh3` | 大弹层 |
| `--shf` | focus ring |

## 过渡 alias

为了降低迁移风险，部分旧 token 仍映射到 Nibi：

- `--display`、`--sans`、`--mono`
- `--bg-elev`、`--bg-sunken`、`--ink-*`、`--line`
- `--accent-*`
- `--vm-display`、`--vm-sans`、`--vm-mono`、`--vm-accent`

新增代码不要主动使用这些旧 alias。改旧页面时，优先换成短名 token。

## 禁止项

- 不新增旧 token 文件。
- 不新增旧粉紫蓝硬编码色值。
- 不使用负 `letter-spacing`。
- 不在正文和密集 UI 中使用 display 字体。
