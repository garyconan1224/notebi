@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"

if not exist "%ROOT%runtime\python\python.exe" goto source_mode

set "PYTHON_EXE=%ROOT%runtime\python\python.exe"

set "HF_HUB_OFFLINE=1"
set "TRANSFORMERS_OFFLINE=1"
set "HF_DATASETS_OFFLINE=1"
set "NOTEBI_ROOT=%ROOT%"

echo [NoteBi] 正在执行离线预检并启动，不能联网下载依赖或模型。
"%PYTHON_EXE%" "%ROOT%scripts\windows_start.py" --root "%ROOT%"
if errorlevel 1 (
  echo.
  echo [NoteBi] 启动失败，请查看 logs\backend.log 和 logs\frontend.log。
  pause
  endlocal
  exit /b 1
)
endlocal
exit /b 0

:source_mode
if not exist "%ROOT%.venv\Scripts\python.exe" (
  echo [NoteBi] 当前目录没有内置 runtime，也没有 .venv。
  echo [NoteBi] 源码模式请先按 README 安装 Python 依赖；内网懒人包需要准备 runtime\python。
  pause
  endlocal
  exit /b 1
)
echo [NoteBi] 未发现内置 runtime，切换到 Windows 源码开发模式。
"%ROOT%.venv\Scripts\python.exe" "%ROOT%scripts\windows_dev_start.py" --root "%ROOT%"
if errorlevel 1 (
  pause
  endlocal
  exit /b 1
)
endlocal
