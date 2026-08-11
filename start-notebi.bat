@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"

if not exist "%ROOT%.venv\Scripts\python.exe" (
  echo [NoteBi] 当前目录没有 .venv。
  echo [NoteBi] 请先按 README 安装 Python 依赖。
  pause
  endlocal
  exit /b 1
)
echo [NoteBi] 正在启动 Windows 源码开发模式。
"%ROOT%.venv\Scripts\python.exe" "%ROOT%scripts\windows_dev_start.py" --root "%ROOT%"
if errorlevel 1 (
  pause
  endlocal
  exit /b 1
)
endlocal
