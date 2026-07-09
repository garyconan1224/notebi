# Git 行为 / 分支策略 / Push 暂缓 / 工具串行交接 / 用户卡住处理

> 本文件由 `CLAUDE.md` §7 索引指向。AI 用 `rg -n "^##" docs/rules/git-workflow.md` 查目录后再 `sed -n` 读片段。

---

## 1. Git 行为（强制）

1. **每个子任务完成后立即 commit**，不要堆积多个子任务到一个 commit。
2. **Commit 信息格式**：

   ```
   <type>(<phase>): <子任务编号> <一句话描述>
   ```

   - type 选一个：`feat` | `fix` | `refactor` | `docs` | `test` | `chore`
   - 例：`feat(phase-n1): N1.3 添加 trashed 状态字段`

3. **修上一次 commit 的小问题用 `git commit --amend`**，不要新建一个 fixup commit。
4. **永远不在 main 分支直接改代码**。新 Phase 开始时先 `git checkout -b feat/phase-n1`。
5. **Phase 完成时只提醒打 tag，不自动打 tag**。让用户自己决定何时打。

---

## 2. Push 策略（2026-05-18 调整）

**暂缓所有 `git push origin` 操作**，等做到 **[D] 开源准备阶段** 才开始统一推送：

- ❌ 不要主动 `git push origin main`
- ❌ 不要主动 `git push origin <feature-branch>` 提交 PR
- ❌ 不要为修 CI 而 push 触发 GitHub Actions
- ✅ 所有 commit 都留在 local main 或本地 feature 分支
- ✅ feature 分支完成后**本地 merge 进 local main**（不走 PR）
- ✅ local main 会越来越领先 origin/main，**这是预期状态**
- ✅ 到 [D] 阶段统一做一次完整 push + 仓库整理

**原因**：开源前 origin 状态不需要保持同步，本地 commit 历史是真相源；过早暴露半成品仓库 / 跑 CI 都是浪费。

**例外**（必须先问用户授权）：

- 用户明确说"现在推一次"
- 临时需要从其他机器拉代码做协作（罕见，问清楚再做）

**已存在的远端分支处理**：

- `docs/spec-merged` 分支已 push（含 PR #1）—— 不再追加 push，PR 留着或关闭由用户决定
- **不主动 `git push --delete` 清理远端分支**
- 后续若再被迫 push（如手机端备份），先问用户

---

## 3. 工具串行交接（不再多 agent 并发）

> **协作模式**：用户**单 agent 串行**工作 —— 一次只在一个 AI 工具里做一个子任务，做完 commit + merge 进 main 之后再换另一个工具继续。**不再多个 AI 同时改同一个项目**，所以历史上的「多 agent 防撞规则」整体作废。

### 3.1 每次会话开始的启动检查

```bash
git status --short --branch       # 必须 clean（或只有本次任务相关改动）
git log --oneline -5              # 看 main 上次留到哪
git branch --show-current         # 确认当前分支
```

**三种情况必须停下来问用户**：

1. 工作区有未提交改动，且看上去**不属于本次说好的子任务**（很可能是上次换工具时漏 commit 的工作）。
2. main 最近 commit 与你认知的"上次留下的状态"对不上（可能你正在覆盖别的工具刚做的工作）。
3. 当前分支不是预期分支（比如想做 1F 却在某个旧 worktree 分支上）。

### 3.2 分支生命周期（简化）

1. **开工**：复杂阶段开 `feat/<编号>-<短名>` 或 `claude-official/<task>` 都行，由用户选；简单阶段直接打 main。
2. **收工**：commit 后通知用户 merge，**不自行 merge 到 main**（破坏性操作仍需用户授权）。
3. **完工后**：用户决定何时把旧分支删掉（参考 main 上已合并的分支即可安全 `git branch -d`）。

### 3.3 工具串行不要做的事

- ❌ 不要 cherry-pick / rebase 旧 worktree 上的 commit，除非用户明确指令（很可能是历史遗留实验，不一定有价值）。
- ❌ 不要主动 push 占座 —— 串行模式不需要。
- ❌ 不要在没看清 diff 的情况下删未合并分支（即便它"看起来是旧的"）。
- ❌ 不要因为分支名带 `claude-official/` 或 `codex/` 就推断它属于不同 agent —— 这是历史命名残留，不再有职责区分。

---

## 4. 当用户卡住时

如果用户说"跑不起来"、"报错了"、"看不懂"等：

1. **先让他贴完整报错信息**，不要凭直觉猜。
2. **再让他描述他做了哪一步**（运行了什么命令、改了哪个文件）。
3. **再给方案**。如果是新手常见错误（比如忘了 activate venv、端口占用、CORS），用一句话点破。
4. **修复后总结**："这个错的根因是 X，下次看到 Y 现象就是这个问题"。
