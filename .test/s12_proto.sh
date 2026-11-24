#!/system/bin/sh
# 步骤 12 原型：用 WebView 的 canvas 现造一张「含唯一随机串」的图，分享 → OCR → 看 OCR 到底读出什么。
# 目的：确认 canvas 渲染的拉丁串能被本地 OCR 逐字读出来（决定 OCR 断言能不能收紧到只能由图片文字满足）。
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"
load_app_env "$HERE"
DATA="/data/data/$APP_PACKAGE/files"
GLOG="$DATA/enote/enote.log"
TLOG="$DATA/testlog.txt"
PY=python3
readlog()  { asroot_global "cat '$GLOG' 2>/dev/null" 2>/dev/null || true; }
readtlog() { asroot_global "cat '$TLOG' 2>/dev/null" 2>/dev/null || true; }
PORT=$(readlog | grep -o '127.0.0.1:[0-9]*' | tail -1 | cut -d: -f2)
api_get() { curl -s -m "${2:-30}" "http://127.0.0.1:$PORT/api/$1"; }
api_state() { api_get state 10; }
echo "PORT=$PORT"

UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"

RS=$(tr -dc 'ACDEFGHJKLMNPQRTUVWXY34679' < /dev/urandom | head -c 8)
echo "RS=$RS"

cat > "$TMPDIR/jseval.sh" <<'EOS'
#!/system/bin/sh
am start -n dev.xduo.enote/.MainActivity --es hook jseval --es arg "$(cat "$1")" >/dev/null
EOS

N0=$(readtlog | wc -l)
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' "(async function(){
  var L=function(m){console.log(\"OCRB64 \"+m)};
  var RS=\"$RS\";
  try{
    var c=document.createElement(\"canvas\"); c.width=900; c.height=300;
    var g=c.getContext(\"2d\");
    g.fillStyle=\"#ffffff\"; g.fillRect(0,0,900,300);
    g.fillStyle=\"#000000\"; g.textBaseline=\"top\";
    g.font=\"bold 84px sans-serif\"; g.fillText(RS, 40, 40);
    g.font=\"44px sans-serif\"; g.fillText(\"取快递 与图片文字\", 40, 180);
    var u=c.toDataURL(\"image/png\");
    var b=u.split(\",\")[1]||\"\";
    L(\"len=\"+b.length);
    for(var i=0;i<b.length;i+=1200){ L(\"d \"+i+\" \"+b.slice(i,i+1200)) }
    L(\"done=1\");
  }catch(e){ L(\"ERR=\"+(e&&e.message)); L(\"done=1\") }
})()" > "$TMPDIR/jsocr.json"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsocr.json'"
i=0
while [ $i -lt 40 ]; do
  readtlog | tail -n +$((N0 + 1)) | grep -q 'OCRB64 done=1' && break
  sleep 0.5; i=$((i+1))
done
echo "poll tries=$i"
readtlog | tail -n +$((N0 + 1)) | grep 'OCRB64 ' > "$TMPDIR/ocrb64.log"
wc -c "$TMPDIR/ocrb64.log"
grep -o 'OCRB64 len=[0-9]*' "$TMPDIR/ocrb64.log"
grep -o 'OCRB64 ERR=.*' "$TMPDIR/ocrb64.log" | head -2

"$PY" - "$TMPDIR/ocrb64.log" "$HERE/.test/ocr-rand.png" <<'PY'
import base64, re, sys
lines = [l.rstrip("\n") for l in open(sys.argv[1], encoding="utf-8", errors="replace")]
parts = {}
for l in lines:
    m = re.search(r"OCRB64 d (\d+) (.*)$", l)
    if m:
        parts[int(m.group(1))] = m.group(2).strip()
blob = "".join(parts[k] for k in sorted(parts))
print("chunks=%d bytes=%d" % (len(parts), len(blob)))
open(sys.argv[2], "wb").write(base64.b64decode(blob))
PY
ls -l "$HERE/.test/ocr-rand.png"

EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"
UID_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
BEFORE_ID=$(api_state | "$PY" -c 'import json,sys; print(max(n["id"] for n in json.load(sys.stdin)["notes"]))')
echo "BEFORE_ID=$BEFORE_ID"
asroot_global "mkdir -p '$EXT' && cp '$HERE/.test/ocr-rand.png' '$EXT/ocr-rand.png' && chown '$UID_APP:$UID_APP' '$EXT/ocr-rand.png' && chmod 644 '$EXT/ocr-rand.png'"
asroot "am start -n $APP_PACKAGE/.ShareActivity -a android.intent.action.SEND -t 'image/*' --eu android.intent.extra.STREAM file://$EXT/ocr-rand.png" >/dev/null
n=0
while [ $n -lt 150 ]; do
  LAST=$(api_state | "$PY" -c '
import json,sys
for n in json.load(sys.stdin)["notes"]:
    if n["source"]=="share-image" and n.get("ocrMs",0)>0 and n["id"]>sys.argv[1]:
        print(json.dumps(n, ensure_ascii=False)); break
' "$BEFORE_ID" 2>/dev/null)
  [ -n "$LAST" ] && break
  sleep 2; n=$((n+2))
done
echo "wait tries=$n"
printf '%s' "$LAST" | "$PY" -c '
import json,sys
n=json.load(sys.stdin)
print("id:", n["id"], "status:", n["status"], "ocrMs:", n.get("ocrMs"))
print("title:", n.get("title"))
print("rawText:", (n.get("rawText") or "")[:200])
print("ocrText:", (n.get("ocrText") or "")[:300])
'
