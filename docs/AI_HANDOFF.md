# AI Handoff

## 当前执行指针（2026-07-29，产品重构已验收）

- **当前分支与基线**：`codex/continue-product-redesign`，最新提交为 `16b86b7 feat: complete collection and task transparency workflows`。该分支尚未合入 `main`；仓库未配置 remote，不执行 push。
- **完成范围**：macOS/Linux 的 NoteBi 产品重构已完成且已验收：共享关系的多合集归类、首页/笔记同步、任务中心透明度、设置与监控统一、NoteShell 总结编辑与 AI 工具、说话人重试、模型能力降级与本地模型下载/切换。
- **产品边界**：不做 Windows、安装包或整合包；合集删除只解除归类，原始笔记、总结、转写和媒体仍保留；音乐分析、风格报告、Suno/Udio 提示词均已退役。其他已确认边界见 [`PRODUCT_DECISIONS.md`](PRODUCT_DECISIONS.md)。
- **设计依据**：Open Design 项目“页面设计优化审查”（`2bd11d3f-ecc1-4d2c-89b5-d7e95b41c8d1`）已成功完成并关联本仓库；设计产物覆盖设置、合集、任务、导出、AI 工具、说话人与时间轴的统一交互。
- **验收结果**：后端全量 `1332 passed, 2 skipped`；前端 Vitest `342 passed`；ESLint、TypeScript 生产构建、Python 编译与 `pip check` 均通过。浏览器已实际渲染合集、任务中心、设置、监控和笔记库。
- **当前停点**：代码与设计均已收口。后续如需继续，应先由用户指定新的产品目标；不得因旧路线自动启动 Windows 或整合包工作。

## 当前执行顺序

1. 以当前 Git 与上述 Open Design 项目为唯一当前事实来源；历史 S0–S6 记录不再作为执行指针。
2. 新需求先确认产品边界与涉及范围，再建立独立计划和验收标准。
3. 未经用户明确授权，不启动 Windows、安装包、整合包、合并到 `main` 或远程推送。

## 启动检查

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

Git 与运行结果优先于本文档；若指针漂移，先报告再继续。
