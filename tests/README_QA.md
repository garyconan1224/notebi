# Nibi QA 验收脚本说明

本目录下的 `e2e_qa.py` 用于离线验收核心流程（新建项目 → 视频分析 mock → 创作知识库加载），不依赖真实 API。

**不需要启动 FastAPI**：在仓库根目录直接运行 Python 即可，与 `README.md` 中的「本地双终端」主流程相互独立（QA 面向离线回归；联调下载/分析/分镜任务时再起后端）。

## 运行方式

在仓库根目录执行：

```bash
python tests/e2e_qa.py
```

如果本地默认是 `python3`，使用：

```bash
python3 tests/e2e_qa.py
```

## 脚本覆盖范围（12 项）

1. `app.py` 语法检查
2. `pages/*.py` 语法检查
3. `shared/*.py` 语法检查
4. 设置保存并重新加载一致
5. `clear_settings()` 后恢复默认
6. 项目目录结构创建正确
7. 当前项目切换持久化正确
8. 视频分析 mock 跑通
9. JSON 同步到项目目录
10. 知识库从项目 JSON 加载成功
11. `split_three_plans()` 解析正确
12. `api_key_resolver` 优先级正确（`settings > env > 空串`）

## Mock 策略

- mock `analyze_video_frame`：返回固定帧描述
- mock `generate_video_summary`：返回固定总结文本
- mock `create_embeddings`：返回固定向量
- 自动构造一个 5 帧测试视频用于分析流程

## 输出说明

执行后会打印类似：

```text
=== Nibi QA 验收报告 ===
[PASS] #01 ...
...
通过 12/12  失败 0/12
```

只要存在失败项，脚本会返回非 0 退出码，可直接用于 CI 阻断。
