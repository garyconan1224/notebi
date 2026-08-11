@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"

if exist "%ROOT%.venv\Scripts\python.exe" (
  "%ROOT%.venv\Scripts\python.exe" "%ROOT%scripts\windows_stop.py" --root "%ROOT%"
) else (
  py -3.11 "%ROOT%scripts\windows_stop.py" --root "%ROOT%"
)
pause
endlocal
