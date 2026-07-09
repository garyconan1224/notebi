# Track K · E2E 测试执行卡 —— 抖音（mimo 执行）

> 给 mimo 的开工卡。**这是第一次用新 skill 验证你方法对不对，先只测抖音这一个平台。**
> B站① 已由 Claude 桌面真跑验证通过（item `7de53e21`），不用再测。

## ⚠️ 强制第一步：读 skill

完整读 [`.claude/skills/e2e-fullflow-test/SKILL.md`](../../.claude/skills/e2e-fullflow-test/SKILL.md)，严格执行开头那 **4 条铁律**。这个 skill 就是因为你上次翻车（虚构 `/pipeline/tasks`、幻觉数据报 3 个假 bug）才写的，逐条照做：

1. **只用 playwright MCP 点真实 UI。开工先验证 playwright 可用**（`browser_navigate` 能打开 `http://localhost:5177`）——**不可用就立即停下，回报"playwright 不可用"，绝对禁止自己写 requests/Python 脚本绕过。**
2. **禁止虚构 API 端点**。真实契约在 skill 里，**没有 `/pipeline/tasks`**。
3. **禁止编造任何数据**。没在页面或真实 API 亲眼看到的，一律写"未观测"。
4. **每条结论配证据**：截图路径 或 DOM 断言结果。

## 测试素材

- 抖音 `https://v.douyin.com/IPzRrCYK9pc/`（林粒粒呀·小白速通 Codex），**带图 + 不带图各跑一次**。
- 短链若 sniff 不认，先在浏览器看它 302 到的真实地址再用。

## 关键操作点（skill「提交流程实测要点」，别踩坑）

- 进工作空间 → 点「添加素材」→ 填链接 → 等 sniff 识别。
- 配图开关默认**开**（带图）；不带图用例要手动关「笔记里配图」。
- 提交是点弹窗**底部的 `button.btn-primary`「生成笔记」**，不是顶部那个宽标题卡片（点错不提交也不报错）。
- 提交后跳 `/processing/note-<taskid>`，看实时进度；**85%「入库中」是正常收尾，不是卡住**。
- 用真实 API `GET /workspaces/{wid}` 看 item 实时 status（落盘 json 的 status 是旧值，别拿它下结论）。

## 完成后回报

按 skill 报告模板贴：①playwright 全程是否可用 ②每步截图路径 ③产物（item id / status / 转写字数 / 有无配图）④结果页按钮 checklist ⑤遇到的问题。**最后逐条勾 skill 末尾的「完成前自检清单」再交报告。**

> 记住：看到什么报什么，没看到就说没看到。报"bug"前先排除是不是自己点错/读错层。
