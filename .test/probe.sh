#!/bin/bash
# 一次性探针：在设备 WebView 里跑一段 JS，读回 console 输出。
# 用法：./.test/probe.sh '<js>' [grep 前缀] [等待秒]
cd "$(dirname "$0")/.." || exit 1
source lib/root.sh
APP_PACKAGE=dev.xduo.enote
DATA="/data/data/$APP_PACKAGE/files"
TLOG="$DATA/testlog.txt"
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
N0=$(asroot_global "cat '$TLOG' 2>/dev/null" | wc -l)
python3 -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' "$1" > .test/probe.json
asroot_global "cat > /data/local/tmp/probe.json" < .test/probe.json
# am start 从 Termux 直接发会被 Android 16 的后台启动限制（BAL）挡掉：logcat 里是
# "Background activity launch blocked"，am 自己还打印 Starting: Intent，看起来像成功了。
# test.sh 的载荷是 asroot_global "sh jseval.sh" 跑的，root 发 intent 不受 BAL 限制，这里对齐。
asroot_global "am start -n dev.xduo.enote/.MainActivity --es hook jseval --es arg '$(cat .test/probe.json)'" >/dev/null
sleep "${3:-5}"
asroot_global "cat '$TLOG' 2>/dev/null" | tail -n +$((N0+1)) | grep "${2:-PROBE}"
