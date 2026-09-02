@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Prism requires Node.js 22.12 or newer.
  echo Install the current LTS release from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

node scripts\check-runtime.mjs
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing Prism dependencies...
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

call npm start
if errorlevel 1 pause
