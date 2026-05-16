@echo off
echo ========================================
echo  Urgify Firewall Fix - Run as Admin
echo ========================================
echo Adding firewall rule for Expo (port 8081)...
netsh advfirewall firewall delete rule name="Expo Metro 8081" >nul 2>&1
netsh advfirewall firewall add rule name="Expo Metro 8081" dir=in action=allow protocol=TCP localport=8081

echo Adding firewall rule for Backend (port 5000)...
netsh advfirewall firewall delete rule name="Urgify Backend 5000" >nul 2>&1
netsh advfirewall firewall add rule name="Urgify Backend 5000" dir=in action=allow protocol=TCP localport=5000

echo.
echo ========================================
echo  Done! Both ports are now open.
echo  Your phone and emulator can now connect.
echo ========================================
pause
