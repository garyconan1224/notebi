# GitHub 开源发布清单

> 用于把本地仓库发布到 GitHub 前的最终检查。默认先推私有仓库，CI 绿后再公开。

## 1. 冻结公开分支

- [ ] 当前分支是用于公开的准备分支，例如 `codex/opensource-prep`。
- [ ] `git status --short --branch` 中没有未决业务改动混入开源整理提交。
- [ ] 不公开的本地功能、实验适配器和测试计划已移出公开分支。

## 2. 敏感信息

- [ ] `.env`、`frontend/.env.development`、`data/`、`.local/`、`output/`、`projects/` 未被 git 跟踪。
- [ ] 执行过当前文件扫描：

```bash
rg -n --hidden -g '!.git/**' -g '!node_modules/**' -g '!frontend/node_modules/**' \
  -e '(sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})'
```

- [ ] 如要公开历史，执行过 git 历史扫描（例如 `gitleaks detect --source .`）。

## 3. 文档

- [ ] `README.md` 说明本地优先、启动方式、环境变量、第三方平台限制和版权责任。
- [ ] `LICENSE` 存在且符合预期。
- [ ] `CONTRIBUTING.md`、`SECURITY.md`、`SUPPORT.md` 存在。
- [ ] 内部 handoff、长期施工计划、历史截图和测试证据已决定保留或迁移。

## 4. CI

- [ ] `python3 -m py_compile backend/app/main.py` 通过。
- [ ] `python3 -m compileall -q backend shared src` 通过。
- [ ] `cd frontend && pnpm build` 通过。
- [ ] GitHub Actions 在私有仓库至少跑过一次。
- [ ] E2E workflow 只手动触发，避免无 API Key / 无素材时阻塞 PR。

## 5. GitHub 发布

- [ ] 创建 GitHub 私有仓库。
- [ ] 添加 remote。
- [ ] push 准备分支。
- [ ] 确认 Actions、README、Issue 模板和安全报告入口正常。
- [ ] 合并到 `main` 或把准备分支设为默认分支。
- [ ] 最后再把仓库改为 public。
