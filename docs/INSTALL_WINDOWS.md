# Windows 安装与启动

## 桌面预览安装包

Windows x64 预览版使用 NSIS 安装器。请从 [Desktop Preview Packages 工作流](https://github.com/garyconan1224/notebi/actions/workflows/desktop-preview.yml) 下载 `notebi-windows-x64-unsigned-preview` Artifact 并解压后运行安装器。

- 安装器会让你选择应用安装目录。
- 这是未签名开发预览版，Windows 可能显示“未知发布者”或 SmartScreen 提示。
- 安装和首次打开不会下载模型；进入「设置 → 本地模型」后选择模型目录，并点击具体模型下载。
- 当前仅经过 CI 打包与启动检查，仍需要真实 Windows x64 机器完成安装、媒体处理和模型下载验收。

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

`start-notebi.bat` 使用 `.venv` 启动 FastAPI 和 Vite 开发服务器。

## 停止与日志

双击 `stop-notebi.bat`。源码模式日志位于：

```text
.local\backend.log
.local\frontend.log
```

模型服务地址仍然通过应用内「设置 → 模型与渠道」配置，不在启动脚本中硬编码。
