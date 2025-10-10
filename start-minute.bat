@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM === перейти в папку со скриптом (functions) ===
cd /d "%~dp0"

echo ---------------------------------------------
echo Minute: auto-start server + ngrok + webhook
echo ---------------------------------------------

REM === 1) Считать BOT_TOKEN из .env (если есть) ===
set "BOT_TOKEN="

for /f "usebackq tokens=* delims=" %%A in (`
  powershell -NoProfile -Command ^
    "$env:BOT_TOKEN=$null; " ^
    "(Get-Item '.env' -ErrorAction SilentlyContinue) ^|^| exit 0; " ^
    "$line=(Get-Content -Raw '.env') -split \"`n\" ^| Where-Object { $_ -match '^\s*BOT_TOKEN\s*=' } ^| Select-Object -First 1; " ^
    "if($line){ ($line -split '=',2)[1].Trim() }"
`) do set "BOT_TOKEN=%%A"

REM если вдруг переменная есть в окружении – тоже ок
if "%BOT_TOKEN%"=="" if defined BOT_TOKEN set "BOT_TOKEN=%BOT_TOKEN%"

if "%BOT_TOKEN%"=="" (
  echo [ERROR] BOT_TOKEN не найден в .env и переменных среды.
  echo Добавь строку в .env:  BOT_TOKEN=123456:ABCDEF...
  echo И перезапусти этот скрипт.
  pause
  exit /b 1
)

echo BOT_TOKEN найден.

REM === 2) Запустить сервер (в новом окне) ===
echo Запускаю node server.js...
start "Minute Server" cmd /k node server.js

REM === 3) Запустить ngrok (в новом окне) ===
echo Запускаю ngrok...
start "ngrok" cmd /k ngrok http 3000

REM === 4) Подождать, пока ngrok поднимется, и вытащить public_url ===
echo Ожидаю, пока поднимется ngrok и выдаст публичный URL...
powershell -NoProfile -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "for($i=0;$i -lt 40;$i++){" ^
  "  try{" ^
  "    $t=(Invoke-RestMethod http://127.0.0.1:4040/api/tunnels -TimeoutSec 1).tunnels;" ^
  "    $u=($t | Where-Object { $_.public_url -like 'https*' } | Select-Object -First 1 -ExpandProperty public_url);" ^
  "    if($u){ [Console]::Out.Write($u); break }" ^
  "  } catch{}" ^
  "  Start-Sleep -Milliseconds 500" ^
  "}" ^
  > "%TEMP%\_ngrok_url.txt"

if not exist "%TEMP%\_ngrok_url.txt" (
  echo [ERROR] Не удалось получить адрес ngrok.
  pause
  exit /b 2
)

set /p NGROK_URL=<"%TEMP%\_ngrok_url.txt"
del "%TEMP%\_ngrok_url.txt" >nul 2>nul

if "%NGROK_URL%"=="" (
  echo [ERROR] ngrok не вернул публичный URL.
  pause
  exit /b 3
)

echo NGROK_URL: %NGROK_URL%

REM === 5) Сформировать webhook и вызвать setWebhook ===
set "WEBHOOK=%NGROK_URL%/telegram/webhook"
echo Устанавливаю Webhook: %WEBHOOK%
curl.exe -s "https://api.telegram.org/bot%BOT_TOKEN%/setWebhook?url=%WEBHOOK%" > "%TEMP%\_wh.json"
echo Ответ Telegram:
type "%TEMP%\_wh.json"
del "%TEMP%\_wh.json" >nul 2>nul
echo.

echo Проверка getWebhookInfo:
curl.exe -s "https://api.telegram.org/bot%BOT_TOKEN%/getWebhookInfo"
echo.

REM === 6) Доп. проверка твоего статуса бэка ===
echo.
echo Проверка /api/status:
curl.exe -s "%NGROK_URL%/api/status"
echo.

echo ---------------------------------------------
echo Готово! Бот привязан к новому ngrok-домену.
echo Окна "Minute Server" и "ngrok" не закрывай.
echo ---------------------------------------------
pause
