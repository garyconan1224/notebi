# NoteBi 独立启动说明

这个目录是 NoteBi 源码目录。完整的跨平台安装、桌面预览包和模型下载流程请先阅读根目录 `README.md`。

## 最快打开

双击：

```bash
启动 NoteBi.command
```

启动成功后浏览器会自动打开。也可以手动打开：

```bash
http://localhost:5181
```

后端健康检查地址：

```bash
http://localhost:8001/health
```

## 停止

双击：

```bash
停止 NoteBi.command
```

或在终端运行：

```bash
cd /Users/conan/Desktop/notebi
./stop-notebi.command
```

## 开发启动

如果已经通过完整启动器装好依赖，可以用更快的开发启动：

```bash
cd /Users/conan/Desktop/notebi
./dev-notebi.sh
```

## 构建静态前端

```bash
cd /Users/conan/Desktop/notebi
./build-notebi.sh
```

构建产物会生成在：

```bash
/Users/conan/Desktop/notebi/frontend/dist
```

## 端口

- 前端：`5181`
- 后端：`8001`

这两个端口是 NoteBi 的默认端口，便于与其他本地项目并行运行。

## Windows

Windows 源码模式使用：

```text
start-notebi.bat
stop-notebi.bat
```

## 首次启动说明

第一次双击启动器时会自动检查并安装 Homebrew、Python、ffmpeg、Node.js、pnpm、Python 依赖和前端依赖，可能需要几分钟。启动器会把这个独立目录的 `.env` 自动设置好：

```bash
VITE_PORT=5181
BACKEND_PORT=8001
```
