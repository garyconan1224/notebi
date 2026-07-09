# Git 常用命令速查笔记

> 一份面向日常开发的 Git 命令笔记，覆盖从提交到协作的高频场景。

## 1. 提交与撤销

最基础也是最高频的一组操作：

- `git add <file>`：把改动放进暂存区
- `git commit -m "msg"`：提交暂存区的改动
- `git commit --amend`：修补**最近一次**提交（改信息或补文件）
- `git restore <file>`：丢弃工作区改动
- `git reset --soft HEAD~1`：撤销上一次提交但保留改动

> ⚠️ `git reset --hard` 会**丢失改动且不可恢复**，慎用。

## 2. 分支与合并

```bash
git switch -c feature/login   # 新建并切到分支
git merge main                # 把 main 合进当前分支
git rebase main               # 把当前分支"嫁接"到 main 最新提交上
```

分支策略的关键：

1. 一个功能一个分支，分支名带语义前缀（feat/fix/docs）
2. 合并前先 `git pull --rebase` 同步，减少冲突
3. 合并后及时删掉已合并的分支

## 3. 查看与对账

| 命令 | 作用 |
|---|---|
| `git status` | 看工作区/暂存区状态 |
| `git log --oneline -20` | 看最近 20 条提交 |
| `git diff` | 看未暂存的改动 |

## 小结

Git 的命令很多，但日常 90% 的工作只用到上面这十几条。先把它们练成肌肉记忆，复杂的 cherry-pick、reflog 等再按需查阅即可。
