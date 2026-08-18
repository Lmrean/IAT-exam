@echo off
setlocal EnableDelayedExpansion
rem ---- deploy to GitHub Pages (IAT-exam) ----
rem URL uses https://git@github.com/ form to bypass global
rem "https://github.com/ -> git@github.com:" insteadOf rewrite,
rem while KEEPING global config (http.proxy etc) intact.

set "SRC=%~dp0"
set "REPO=Lmrean/IAT-exam"
set "BRANCH=main"
set "DEPLOY=G:\Desktop\IAT-exam-deploy"
set "GHURL=https://git@github.com/%REPO%.git"
set "TOKEN="
set "AUTH="

if exist "%SRC%deploy_token.txt" (
  for /f "usebackq delims=" %%a in ("%SRC%deploy_token.txt") do ( if not defined TOKEN set "TOKEN=%%a" )
)
if defined TOKEN (
  for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "$t=$env:TOKEN; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('Lmrean:'+$t))"`) do set "AUTH=%%a"
)

call :MAIN
echo.
echo ============================================================
echo  Done. Open: https://lmrean.github.io/IAT-exam/
echo ============================================================
pause >nul
goto :EOF

:MAIN
echo ============================================================
echo  Sier CPA Quiz - one-click deploy to GitHub Pages
echo  repo : %REPO%   branch: %BRANCH%
echo  src  : %SRC%
echo  dest : %DEPLOY%
echo ============================================================
echo.
call :CLONE
if errorlevel 1 goto :EOF
call :COPY
if errorlevel 1 goto :EOF
call :COMMIT
call :PUSH
goto :EOF

:CLONE
echo [1/4] Clone repo over HTTPS ...
if exist "%DEPLOY%" (
  echo   removing old deploy dir ...
  rmdir /s /q "%DEPLOY%" 2>nul
)
git clone "%GHURL%" "%DEPLOY%" 2>&1
if errorlevel 1 (
  echo [ERR] clone failed! check:
  echo   1. repo renamed/created as %REPO%
  echo   2. internet + git installed
  echo   3. deploy_token.txt must contain a classic token with repo scope
  exit /b 1
)
exit /b 0

:COPY
echo [2/4] Copy sier-app into deploy dir ...
xcopy "%SRC%*.*" "%DEPLOY%\" /E /Y /Q >nul
if errorlevel 1 (
  echo [ERR] copy failed!
  exit /b 1
)
if exist "%DEPLOY%\deploy_token.txt" del /f /q "%DEPLOY%\deploy_token.txt"
exit /b 0

:COMMIT
echo [3/4] Commit changes ...
cd /d "%DEPLOY%"
if not exist ".git" (
  echo [ERR] no .git found, clone must have failed.
  exit /b 1
)
git config user.name >nul 2>&1 || git config user.name "Lmrean"
git config user.email >nul 2>&1 || git config user.email "lmrean@users.noreply.github.com"
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "deploy: update quiz app (bank + ui)" 2>&1
) else (
  echo  nothing new to commit, already up to date.
)
exit /b 0

:PUSH
echo [4/4] Push to GitHub over HTTPS ...
cd /d "%DEPLOY%"
if not exist ".git" (
  echo [ERR] no .git found, clone must have failed.
  exit /b 1
)
set /a TRY=1
:PUSH_LOOP
if defined AUTH (
  git -c http.extraHeader="Authorization: Basic %AUTH%" push "%GHURL%" %BRANCH% 2>&1
) else (
  git push origin %BRANCH% 2>&1
)
if not errorlevel 1 (
  echo  push ok.
  exit /b 0
)
if %TRY% GEQ 3 (
  echo [ERR] push failed after %TRY% tries! check network / token / repo permission.
  exit /b 1
)
echo   network hiccup, retry %TRY% in 5s ...
set /a TRY+=1
timeout /t 5 /nobreak >nul
goto :PUSH_LOOP
