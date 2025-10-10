@echo off
title Stop Minute App
echo ---------------------------------------------
echo 🔴 Остановка Minute сервера и ngrok...
echo ---------------------------------------------

REM === Завершить ngrok ===
echo Закрываю ngrok...
taskkill /F /IM ngrok.exe >nul 2>nul

REM === Завершить Node.js сервер ===
echo Закрываю Node.js (server.js)...
taskkill /F /IM node.exe >nul 2>nul

REM === Проверка ===
timeout /t 1 >nul

tasklist | find /i "ngrok.exe" >nul
if %errorlevel%==0 (
  echo ⚠ ngrok все еще работает.
) else (
  echo ✅ ngrok остановлен.
)

tasklist | find /i "node.exe" >nul
if %errorlevel%==0 (
  echo ⚠ Node.js все еще работает.
) else (
  echo ✅ Node.js остановлен.
)

echo ---------------------------------------------
echo 🟢 Все процессы завершены.
echo ---------------------------------------------
pause
