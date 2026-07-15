@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "PYTHON_EXE=%ROOT%runtime\python\python.exe"

if exist "%PYTHON_EXE%" (
  "%PYTHON_EXE%" "%ROOT%scripts\windows_stop.py" --root "%ROOT%"
) else if exist "%ROOT%.venv\Scripts\python.exe" (
  "%ROOT%.venv\Scripts\python.exe" "%ROOT%scripts\windows_stop.py" --root "%ROOT%"
) else (
  py -3.11 "%ROOT%scripts\windows_stop.py" --root "%ROOT%"
)
pause
endlocal
