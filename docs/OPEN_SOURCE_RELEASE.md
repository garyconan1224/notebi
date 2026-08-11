# NoteBi 开源发布清单

## 发布边界

公开 GitHub 仓库只包含源码、公开文档、测试和不含秘密的配置模板。不要提交：

- `.env`、`.local/settings.json`、API Key、Cookie、内部 IP 和证书
- `data/`、项目素材、用户笔记、SQLite 数据库和任务日志
- 本地模型缓存，除非模型许可证允许且明确作为 Release Asset 发布

## 发布前检查

```bash
git status --short
git diff --check
./.venv/bin/python -m compileall -q backend shared scripts
./.venv/bin/python -m pytest backend/tests -q
cd frontend && pnpm test --run && pnpm build
```

另外检查敏感信息：

```bash
rg -n --hidden -g '!data/**' -g '!.local/**' \
  'sk-[A-Za-z0-9]|api[_-]?key|secret|token|10\.[0-9]+\.[0-9]+\.[0-9]+' .
```

命中后先人工确认，不能简单批量替换历史或用户配置。

## GitHub 发布顺序

1. 本地完成代码、README、安装文档和测试。
2. 创建 GitHub 私有仓库并配置远程地址。
3. 推送当前发布分支，等待 CI 通过。
4. 检查仓库在线页面、README 图片、安装链接和敏感信息。
5. 确认没有问题后，再切换为 Public。
6. 实机验收通过后创建 Release，上传 Windows 未签名预览安装包与 Linux AppImage / `.deb`；不上传模型权重或用户数据。

GitHub 上传、创建远程仓库和切换公开状态都属于外部状态变更，必须由维护者最后确认后执行。
