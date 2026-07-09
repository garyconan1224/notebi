# Nibi 多媒体内容分析系统 — 合并需求规范

> **状态**：已拆分为模块化文档。
> **唯一真相源**：本入口 + `docs/spec/` 下的模块文件共同构成产品需求规范。
> **阅读方式**：先看本索引，再按任务只读相关模块，避免整份规范进入上下文。

---

## 模块进度

- [x] 模块 1：任务系统
- [x] 模块 2：输入层
- [x] 模块 3：前置配置
- [x] 模块 4：视频分支
- [x] 模块 5：音频分支
- [x] 模块 6：图片分支
- [x] 模块 7：文字分支
- [x] 模块 8：复刻专项 + 进度可视 + 界面汇总 + 异常 + 导出

---

## 模块 1：任务系统（顶层架构）

详见 [`docs/spec/01-task-system.md`](spec/01-task-system.md)。

## 模块 2：输入层

详见 [`docs/spec/02-input-layer.md`](spec/02-input-layer.md)。

## 模块 3：前置配置

详见 [`docs/spec/03-preflight-config.md`](spec/03-preflight-config.md)。

## 模块 4：视频分支

详见 [`docs/spec/04-video.md`](spec/04-video.md)。

## 模块 5：音频分支

详见 [`docs/spec/05-audio.md`](spec/05-audio.md)。

## 模块 6：图片分支

详见 [`docs/spec/06-image.md`](spec/06-image.md)。

## 模块 7：文字分支

详见 [`docs/spec/07-text.md`](spec/07-text.md)。

## 模块 8：复刻专项 + 进度可视 + 界面汇总 + 异常 + 导出

详见 [`docs/spec/08-remix-export-progress.md`](spec/08-remix-export-progress.md)。

## 附录

详见 [`docs/spec/appendix.md`](spec/appendix.md)。

---

## 给 AI 的读取规则

1. 不要整读所有 `docs/spec/*.md`。
2. 先用 `rg -n "^##|^###" docs/spec/<module>.md` 看目录。
3. 只用 `sed -n` 读取当前任务相关片段。
4. 旧引用里的 `docs/SPEC.md §N` 对应上方模块 N 的拆分文件。
