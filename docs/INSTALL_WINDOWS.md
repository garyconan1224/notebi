# Windows 安装与启动

NoteBi 在 Windows 上提供两种启动模式，入口文件相同：`start-notebi.bat`。

## 源码模式

适合开发者和需要修改源码的人。

1. 安装 Python 3.11、Node.js 18+ 和 FFmpeg。
2. 在仓库根目录创建环境：

   ```powershell
   py -3.11 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

3. 安装前端依赖：

   ```powershell
   cd frontend
   npm install
   cd ..
   ```

4. 双击 `start-notebi.bat`。

没有 `runtime\python\python.exe` 时，入口会自动使用 `.venv` 启动 FastAPI 和 Vite 开发服务器。

## Windows 离线懒人包

懒人包额外包含：

- `runtime\python\python.exe`
- `runtime\ffmpeg\bin\ffmpeg.exe`
- `runtime\ffmpeg\bin\ffprobe.exe`
- `frontend\dist\index.html`
- `models\manifest.json` 和模型缓存

解压后双击 `start-notebi.bat`。检测到内置 runtime 后，入口会切换为离线模式：不安装依赖、不下载模型、不启动 Node.js，只启动内置 Python 后端和静态前端服务。

## 停止与日志

双击 `stop-notebi.bat`。日志位于：

```text
logs\backend.log
logs\frontend.log
```

详细打包规则见 [Windows 离线懒人包](WINDOWS_OFFLINE_BUNDLE.md)。昇腾模型地址仍然通过应用内「设置 → 模型与渠道」配置，不在启动脚本中硬编码。
