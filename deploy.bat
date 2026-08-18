@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

set "OWNER=Lmrean"
set "REPO=IAT-exam"
set "BRANCH=main"
set "DEPLOY=G:\Desktop\IAT-exam-deploy"
set "SRC=%~dp0"

echo ============================================================
echo  Sier CPA Quiz - one-click deploy to GitHub Pages
echo  repo : %OWNER%/%REPO%   branch: %BRANCH%
echo  src  : %SRC%
echo  dest : %DEPLOY%
echo ============================================================
echo.

call :MAIN

echo.
echo ============================================================
echo  [SCRIPT ENDED] See output above. Press any key to close.
echo  If it failed, follow the [ERR] hints above. You can also
echo  open a Command Prompt, cd into sier-app, and run deploy.bat
echo  to watch live output.
echo ============================================================
pause >nul
goto :EOF

:MAIN
REM --- self-check: git available? ---
where git >nul 2>nul
if errorlevel 1 (
  echo [ERR] git not found. Install Git for Windows first.
  goto :ENDMAIN
)

REM --- self-check: app.js present in source? ---
if not exist "%SRC%app.js" (
  echo [ERR] app.js not found in source: %SRC%
  echo       Make sure this script lives inside the sier-app folder.
  goto :ENDMAIN
)

REM --- prepare deploy dir ---
if exist "%DEPLOY%\.git" (
  echo.
  echo [1/4] Deploy dir exists, try git pull ...
  pushd "%DEPLOY%"
  git pull --ff-only
  if errorlevel 1 (
    popd
    echo [WARN] git pull failed, will delete and re-clone deploy dir.
    choice /C YN /M "Delete and re-clone deploy dir? Y/N"
    if errorlevel 2 ( echo Cancelled. & goto :ENDMAIN )
    rmdir /S /Q "%DEPLOY%"
  ) else (
    popd
  )
)

if not exist "%DEPLOY%\.git" (
  echo.
  echo [1/4] Clone %OWNER%/%REPO% ...
  git clone https://github.com/%OWNER%/%REPO%.git "%DEPLOY%"
  if errorlevel 1 (
    echo.
    echo [ERR] clone failed! Check:
    echo   1. repo renamed/created as %OWNER%/%REPO% on GitHub
    echo   2. internet + git installed
    echo   3. if asked, login via Git Credential Manager popup
    goto :ENDMAIN
  )
)

REM --- 2. copy latest source ---
echo.
echo [2/4] Copy source into deploy dir ...
xcopy "%SRC%" "%DEPLOY%" /E /Y /Q

REM --- 3. commit ---
echo.
echo [3/4] Commit changes ...
pushd "%DEPLOY%"
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git config user.name >nul 2>nul || git config user.name "Lmrean"
  git config user.email >nul 2>nul || git config user.email "Lmrean@users.noreply.github.com"
  git commit -m "merge exclusive-practice bank: +1160 (shiwu25+caioguan10), unified filter (total 2075)"
) else (
  echo Nothing new to commit.
)

REM --- 4. push ---
echo.
echo [4/4] Push to %BRANCH% ...
git push origin %BRANCH%
if errorlevel 1 (
  echo.
  echo [ERR] push failed! Possible causes:
  echo   - no git credential: run git config --global credential.helper manager, retry
  echo   - default branch is not %BRANCH%: change BRANCH to master and retry
  popd
  goto :ENDMAIN
)
popd

echo.
echo ============================================================
echo  Done! Visit after ~1 min:
echo  https://%OWNER%.github.io/%REPO%/
echo  (repo renamed to IAT-exam; old sier-quiz URL is dead)
echo ============================================================

:ENDMAIN
goto :EOF
