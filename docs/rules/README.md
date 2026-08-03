# docs/rules/ — AI 协作详细规则

> 这个目录是 `CLAUDE.md` 第 7 节"规则索引"指向的详细规则集。
> **每个文件按主题独立**，AI 用到再 `rg` / `sed -n` 读片段，**不要预读**。

## 文件清单

| 文件 | 主题 | 何时打开 |
|---|---|---|
| [`context-budget.md`](context-budget.md) | 上下文预算 / 读文件策略 / skill / agent / `/clear` 接力 | 准备读大文件、开 agent、被 compact 之后 |
| [`git-workflow.md`](git-workflow.md) | Git 行为 / commit 颗粒度 / 分支策略 / push 暂缓 / 工具串行交接 / 用户卡住处理 | 准备 commit、merge、新开会话前 |
| [`code-style.md`](code-style.md) | Python / TypeScript 代码风格 + UI 设计规范 + 测试要求 | 写代码 / 改 UI / 加测试前 |
| [`business-contract.md`](business-contract.md) | 业务规格契约：状态机、级联依赖、阈值、可跳过策略、存储清理 | 改 pipeline、前置配置、状态流转、阈值时 |
| [`model-strategy.md`](model-strategy.md) | Codex 调查、直接执行和验证；Claude Code 仅在用户明确要求时可选 | 判断任务由谁执行和是否使用外部工具时 |
| [`project-map.md`](project-map.md) | 项目架构（后端 router / 前端路由 / shared）+ 常用命令 + 端口 + CodeGraph MCP | 新人入门、改路由、找模块入口 |
| [`mimo-onboarding.md`](mimo-onboarding.md) | 外部执行器历史说明（旧文件名保留） | 用户明确要求 Claude Code 时再读 |
| [`agent-roles.md`](agent-roles.md) | **Codex 直接执行**：计划、实现、验证；UI 任务可经 Open Design 设计交接 | 切换工具、实现和 UI 设计评审时 |

## AI 使用方法（重要）

### ✅ 正确做法

```bash
# 1. 先查目录
rg -n "^##" docs/rules/git-workflow.md

# 2. 再读相关段落
sed -n '45,80p' docs/rules/git-workflow.md
```

### ❌ 错误做法

```bash
# 不要整文件 Read，每个 rules 文件都不算小（80-150 行）
# 整文件读就失去拆分意义了
```

## 修改规则的原则

1. **修改了 rules 子文件，CLAUDE.md §7 索引表不需要改**（除非新增/删除文件）。
2. **规则迁移**：如果某条规则从 A 文件挪到 B 文件，记得在 CHANGES.md 留痕。
3. **新增规则**：先想清楚归哪个文件，宁可扩展现有文件也不要新建文件（避免文件数量膨胀）。
4. **不要把规则同时写在 CLAUDE.md 和 rules 文件里**（防止两边漂移）。CLAUDE.md 只放"必须每次会话都看到"的核心铁律，其余全在 rules。

## 历史

- **2026-05-26 创建**：原 CLAUDE.md 538 行瘦身为 ~180 行，6 类规则拆到本目录。零删除。
