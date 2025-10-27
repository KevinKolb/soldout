@echo off
title Fix D Drive Mapping
color 0C

cls
echo ========================================
echo     FIX D: DRIVE MAPPING
echo ========================================
echo.
echo This will remove any subfolder mapping
echo and restore D: to normal.
echo.
pause

echo Removing D: drive mapping...
echo.

rem Remove subst mapping if it exists
subst D: /D

if errorlevel 1 (
    echo.
    echo D: drive is not a subst mapping.
    echo It may already be normal.
) else (
    echo.
    echo SUCCESS: D: drive mapping removed.
    echo D: should now point to the root of the drive.
)

echo.
echo Opening D: drive...
timeout /t 2 >nul
explorer D:

echo.
pause
exit
