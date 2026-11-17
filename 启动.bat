@echo off
chcp 65001 >nul
cd /d %~dp0
echo 正在启动套利监控大屏（本地数据中继）...
start "" http://127.0.0.1:8437/
python server.py
pause
