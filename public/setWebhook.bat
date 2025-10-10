@echo off
:: === Настройки ===
:: Впиши сюда свой токен от BotFather:
set TOKEN=7549326121:AAEyOrHJ1925vh3O7hOduvCQeZNgzgd8Wdo

:: Впиши сюда текущий ngrok-адрес (https://....ngrok-free.app)
set NGROK_URL=https://arian-subcartilaginous-garrulously.ngrok-free.dev

:: === Запрос к Telegram API ===
echo Setting Telegram webhook to %NGROK_URL%/telegram/webhook
curl.exe -s -X POST "https://api.telegram.org/bot%TOKEN%/setWebhook?url=%NGROK_URL%/telegram/webhook"


echo.
pause
