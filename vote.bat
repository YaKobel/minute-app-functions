@echo off
setlocal ENABLEDELAYEDEXPANSION
title Minute — vote sender

REM ==== Перейти в папку проекта ====
cd /d "%~dp0"

REM ==== Считать переменные из .env ====
if not exist ".env" (
  echo [ERROR] .env не найден в %cd%
  pause
  exit /b 1
)

set "APP_KEY="
set "PUBLIC_BASE="

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /I "%%A"=="APP_API_KEY" set "APP_KEY=%%B"
  if /I "%%A"=="PUBLIC_BASE" set "PUBLIC_BASE=%%B"
)

if "%APP_KEY%"=="" (
  echo [ERROR] В .env не найден APP_API_KEY
  pause
  exit /b 1
)

if "%PUBLIC_BASE%"=="" (
  echo [WARN] В .env не найден PUBLIC_BASE. Использую дефолтный ngrok-домен.
  set "PUBLIC_BASE=https://arian-subcartilaginous-garrulously.ngrok-free.dev"
)

set "API=%PUBLIC_BASE%/api/vote"

echo.
echo  =============== MINUTE vote sender ===============
echo   API: %API%
echo.

REM ==== Выбор категории ====
:pickCategory
echo Выбери категорию:
echo   1^) war        (Stop war)
echo   2^) climate    (Cataclysms)
echo   3^) personal   (Personal)
echo   4^) family     (Family)
set /p CATIDX="Ввод (1-4): "
if "%CATIDX%"=="1" set CAT=war
if "%CATIDX%"=="2" set CAT=climate
if "%CATIDX%"=="3" set CAT=personal
if "%CATIDX%"=="4" set CAT=family
if "%CAT%"=="" (
  echo Неверный выбор.
  set "CAT="
  goto :pickCategory
)

REM ==== Страна (ISO-2) ====
set "COUNTRY="
set /p COUNTRY="Страна (ISO2, напр. UA, RU, PL, DE): "
if "%COUNTRY%"=="" set "COUNTRY=UA"

REM ==== Пол ====
:pickGender
set "GENDER="
echo Пол:
echo   1^) male
echo   2^) female
set /p GIDX="Ввод (1-2): "
if "%GIDX%"=="1" set GENDER=male
if "%GIDX%"=="2" set GENDER=female
if "%GENDER%"=="" (
  echo Неверный выбор.
  goto :pickGender
)

REM ==== Возраст ====
set "AGE="
set /p AGE="Возраст (число, напр. 25): "
if "%AGE%"=="" set AGE=25

REM ==== userId (для теста можно любое число) ====
set "USERID="
set /p USERID="userId (по умолчанию 123): "
if "%USERID%"=="" set USERID=123

REM ==== Сформировать JSON-пейлоад ====
set "JSON={\"userId\":%USERID%,\"category\":\"%CAT%\",\"country\":\"%COUNTRY%\",\"gender\":\"%GENDER%\",\"age\":%AGE%}"

echo.
echo Отправляю:
echo   %JSON%
echo.

REM ==== Отправка через curl.exe ====
curl.exe -s -X POST ^
  -H "Content-Type: application/json" ^
  -H "X-App-Key: %APP_KEY%" ^
  -d "%JSON%" ^
  "%API%"
echo.
echo ---------------------------------------------------
choice /M "Отправить еще?"
if errorlevel 2 goto :end
goto :pickCategory

:end
echo Готово.
pause
