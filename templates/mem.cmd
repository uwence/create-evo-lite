@echo off
setlocal EnableDelayedExpansion
set "EVO_LITE_GIT_COMMIT="
set "EVO_LITE_GIT_STATUS="
set "EVO_LITE_GIT_STATUS_FILE=%TEMP%\evo-lite-git-status-%RANDOM%-%RANDOM%.txt"
for /f "delims=" %%i in ('git rev-parse --short HEAD 2^>nul') do set "EVO_LITE_GIT_COMMIT=%%i"
git status --porcelain 1>"%EVO_LITE_GIT_STATUS_FILE%" 2>nul
node "%~dp0cli\memory.js" %*
if exist "%EVO_LITE_GIT_STATUS_FILE%" del /q "%EVO_LITE_GIT_STATUS_FILE%" >nul 2>nul
