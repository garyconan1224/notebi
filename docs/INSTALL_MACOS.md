# macOS 安装与启动

## 环境

- macOS 12+
- Python 3.11+
- Node.js 18+
- FFmpeg
- 一个可用的模型服务，或本地模型缓存

## 启动

在 NoteBi 根目录双击：

```text
启动 NoteBi.command
```

或在终端运行：

```bash
./start-notebi.command
```

浏览器地址：`http://localhost:5181`。后端健康检查：`http://localhost:8001/health`。

## 开发模式

```bash
./dev-notebi.sh
```

前端代码在 `frontend/`，后端代码在 `backend/`，共享能力在 `shared/`。模型和 provider 配置通过应用内设置完成，不要把 `.env` 或 `.local/settings.json` 提交到 Git。

## 停止

```bash
./stop-notebi.command
```

首次启动器会按当前 macOS 环境检查开发依赖。
