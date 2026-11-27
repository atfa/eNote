#!/bin/sh
# Acceptance test: clean install, feed a 16 kHz WAV through the ASR engine,
# assert the recognised text on logcat and in the app's result file.
set -eu
cd "$(dirname "$0")"; . ./app.env
APK=$(readlink -f "$APK_NAME")

WAV="$(pwd)/testdata/${TEST_WAV:-zh.wav}"
EXPECT="${TEST_EXPECT:-今天天气怎么样？}"
[ -f "$WAV" ] || { echo "missing sample: $WAV"; exit 1; }

su -c "am force-stop $APP_PACKAGE; pm uninstall $APP_PACKAGE" >/dev/null 2>&1
su -c "pm install -g '$APK'" >/dev/null || { echo "install failed"; exit 1; }

su -c "logcat -c" 2>/dev/null
su -c "input keyevent KEYCODE_HOME"; sleep 1
su -c "am start -n $APP_PACKAGE/.$ACTIVITY" >/dev/null

# phase 1: let the app unpack its models and create its external files dir
# (Android's FUSE layer only grants the app access to dirs the app itself made)
i=0
while [ $i -lt 90 ]; do
  su -c "logcat -d 2>/dev/null | grep -q ' I $TAG *: engine ready'" && break
  sleep 1; i=$((i+1))
done
su -c "logcat -d 2>/dev/null | grep -q ' I $TAG *: engine ready'" || { echo "FAIL: engine not ready in ${i}s"; exit 1; }

EXT="/storage/emulated/0/Android/data/$APP_PACKAGE/files"
su -c "cp '$WAV' '$EXT/test.wav'" || { echo "cannot copy sample"; exit 1; }
U=$(su -c "stat -c %u '$EXT'"); su -c "chown $U:$U '$EXT/test.wav'"

# phase 2: restart so the file path is picked up
su -c "am force-stop $APP_PACKAGE; logcat -c" 2>/dev/null
su -c "am start -n $APP_PACKAGE/.$ACTIVITY" >/dev/null

# wait for the recognition result (engine init + 84 MB model unpack on first run)
i=0; RESULT=""
while [ $i -lt 120 ]; do
  RESULT=$(su -c "logcat -d 2>/dev/null | grep ' I $TAG *:' | grep 'RESULT: '" 2>/dev/null | tail -1 | sed 's/^.*RESULT: //' || true)
  [ -n "$RESULT" ] && break
  sleep 1; i=$((i+1))
done

LOG=$(su -c "logcat -d 2>/dev/null | grep ' I $TAG *:'" 2>/dev/null || true)
echo "--- app log (tail) ---"; echo "$LOG" | tail -12
echo "--- recognised ---"; echo "$RESULT"
echo "--- result.txt ---"; su -c "cat '$EXT/result.txt'" 2>/dev/null; echo

[ -n "$RESULT" ] || { echo "FAIL: no RESULT line in ${i}s"; exit 1; }
case "$RESULT" in
  *"$EXPECT"*) echo "PASS"; exit 0 ;;
esac
echo "FAIL: expected '$EXPECT' got '$RESULT'"; exit 1
