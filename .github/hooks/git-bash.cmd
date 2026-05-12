@echo off
setlocal EnableExtensions

set "BASH_EXE="

if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH_EXE if exist "%ProgramW6432%\Git\bin\bash.exe" set "BASH_EXE=%ProgramW6432%\Git\bin\bash.exe"
if not defined BASH_EXE if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles(x86)%\Git\bin\bash.exe"

if not defined BASH_EXE (
    for %%I in (git.exe) do set "GIT_EXE=%%~$PATH:I"
    if defined GIT_EXE (
        for %%I in ("%GIT_EXE%") do set "BASH_EXE=%%~dpI..\bin\bash.exe"
    )
)

if not defined BASH_EXE (
    >&2 echo Git Bash not found. Install Git for Windows or update .github\hooks\git-bash.cmd.
    exit /b 1
)

set "SCRIPT=%~1"
if not defined SCRIPT (
    >&2 echo Usage: git-bash.cmd script.sh [args...]
    exit /b 1
)

shift
set "ARGS="

:collect_args
if "%~1"=="" goto run_bash
set "ARGS=%ARGS% "%~1""
shift
goto collect_args

:run_bash
call "%BASH_EXE%" "%SCRIPT%" %ARGS%
exit /b %ERRORLEVEL%