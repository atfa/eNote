#!/bin/bash
# 探针 + 虚拟屏截图：把一段 JS 打到 VD 上的 app，等它跑完，截 VD。
# 用法：./.test/vdshot.sh <js 文件> <截图 png> [等待秒]
cd "$(dirname "$0")/.." || exit 1
source lib/root.sh
V=.agents/skills/dev-apk-on-android/scripts/vd.sh
APP_PACKAGE=dev.xduo.enote
DATA="/data/data/$APP_PACKAGE/files"
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
asroot_global "am force-stop $APP_PACKAGE" >/dev/null
bash "$V" launch "$APP_PACKAGE/.MainActivity" >/dev/null 2>&1
sleep 7
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
JS=$(cat "$1" | tr -d '\n')
python3 -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' "$JS" > .test/probe.json
asroot_global "cat > /data/local/tmp/probe.json" < .test/probe.json
VD=$(bash "$V" id)
# 必须带 --display：不带的话 am 会把 app 拉回物理屏，VD 上截到的是桌面。
asroot_global "am start --display $VD -n $APP_PACKAGE/.MainActivity --es hook jseval --es arg '$(cat .test/probe.json)'" >/dev/null
sleep "${3:-5}"
bash "$V" shot "$2"
