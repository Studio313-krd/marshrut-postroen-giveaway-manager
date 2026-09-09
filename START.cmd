@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Установите Node.js 24 или новее: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules\exceljs (
  echo Устанавливаем зависимости приложения...
  call npm.cmd ci
  if errorlevel 1 (
    echo Не удалось установить зависимости. Проверьте доступ к интернету.
    pause
    exit /b 1
  )
)
if not exist .env node scripts\setup.mjs --env-only
echo.
echo Конкурсы Маршрут-Построен
echo Откройте http://127.0.0.1:4310 в Chrome или Edge.
echo При первом запуске: в другом терминале выполните node scripts\setup.mjs
echo Оставьте это окно открытым, пока работаете с приложением.
echo.
node server\index.js
pause
