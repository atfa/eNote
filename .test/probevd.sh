#!/bin/bash
# 和 probe.sh 一样，但应用跑在虚拟屏上（test.sh --vd 的环境）。
# 用法：./.test/probevd.sh '<js>' [grep 前缀] [等待秒]
cd "$(dirname "$0")/.." || exit 1
source lib/root.sh
V=.agents/skills/dev-apk-on-android/scripts/vd.sh
APP_PACKAGE=dev.xduo.enote
DATA="/data/data/$APP_PACKAGE/files"
TLOG="$DATA/testlog.txt"
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
asroot_global "am force-stop $APP_PACKAGE" >/dev/null
bash "$V" launch "$APP_PACKAGE/.MainActivity" >/dev/null 2>&1
sleep 7
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
N0=$(asroot_global "cat '$TLOG' 2>/dev/null" | wc -l)
python3 -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' "$1" > .test/probe.json
asroot_global "cat > /data/local/tmp/probe.json" < .test/probe.json
asroot_global "am start -n $APP_PACKAGE/.MainActivity --es hook jseval --es arg '$(cat .test/probe.json)'" >/dev/null
sleep "${3:-5}"
asroot_global "cat '$TLOG' 2>/dev/null" | tail -n +$((N0+1)) | grep "${2:-PROBE}"
