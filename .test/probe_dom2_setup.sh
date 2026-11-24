#!/bin/bash
# 给 probe_dom2.sh 造一个真实附件：分享一张 PDF 进来（test.sh 的附件步骤同款做法），
# 附件页的 strip / 图标块 / 元信息行才有东西可比。设备端口从页面里读（S.info.server）。
cd "$(dirname "$0")/.." || exit 1
source lib/root.sh
APP=dev.xduo.enote
URL=$(./.test/probe.sh '(async function(){ console.log("PDU " + JSON.stringify(__enote.state.S.info.server)) })()' PDU 10 2>/dev/null | grep -o 'PDU .*' | head -1 | sed 's/^PDU //' | tr -d '"')
BASE=${URL%/}
[ -n "$BASE" ] || { echo "拿不到 app 的本地端口（app 没在跑？）"; exit 1; }
echo "base=$BASE"
TMP="$HOME/.test/tmp"; mkdir -p "$TMP"
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\ntrailer2 dom2\n' > "$TMP/att-dom2.pdf"
EXT="/data/user/0/$APP/files/enote/inbox"
UID_APP=$(asroot_global "stat -c%U /data/data/$APP" | tr -d '\r')
asroot_global "mkdir -p '$EXT' && cp '$TMP/att-dom2.pdf' '$EXT/att-dom2.pdf' && chown '$UID_APP:$UID_APP' '$EXT/att-dom2.pdf' && chmod 644 '$EXT/att-dom2.pdf'" || { echo "staging 失败"; exit 1; }
BEFORE=$(curl -s -m 20 "$BASE/api/attachments" | tr ',' '\n' | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)
asroot_global "am start -n $APP/.ShareActivity -a android.intent.action.SEND -t application/pdf --eu android.intent.extra.STREAM file://$EXT/att-dom2.pdf" >/dev/null 2>&1
sleep 4
AFTER=$(curl -s -m 20 "$BASE/api/attachments" | tr ',' '\n' | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)
echo "attachments: $BEFORE -> $AFTER"
curl -s -m 20 "$BASE/api/attachments" | head -c 260; echo
