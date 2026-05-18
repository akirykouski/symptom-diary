@echo off
REM Double-click this file to start Clario on Windows.
title Clario - Symptom Diary
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Clario stopped with an error. Read the messages above.
  pause
)
