#!/usr/bin/env python3
# 步骤 12：test.sh 的 OCR 断言收紧（插入「现造随机串图」步骤 + 收紧搜索断言）。
# 原子：全部替换成功后才写文件。
import io

P = "test.sh"
s = io.open(P, encoding="utf-8").read()

NEW_STEP = '''
step "share 现造的随机串图 → 本地 OCR 逐字读出（搜索断言只靠它）"
# 为什么现造：搜索断言以前只用「取快递」，它同时出现在分享的文本笔记里，「命中来自图片文字」
# 在 OCR 读得稀烂时也可能绿（文本命中把 total 撑起来，标签断言挑的是任意一条命中）。
# 现在图里写一条**本次运行独有**的随机串：只有 OCR 真把图里的字读出来，断言才可能满足。
# 字符集避开 OCR 易混字形（0/O、1/I/l、2/Z、5/S、8/B），实测逐字读出。
# 图用 WebView 的 canvas 现画：Termux 没有 PIL，纯 python 字体表得自己维护；canvas 用系统真字体，
# 实测本地 OCR 331ms 逐字读出。PNG 的 base64 走 testlog 回传，1200 字符一片（logcat 单行上限约 4KB）。
RS=$(tr -dc 'ACDEFGHJKLMNRTUVWXY34679' < /dev/urandom | head -c 8)
DECOY=$(tr -dc 'ACDEFGHJKLMNRTUVWXY34679' < /dev/urandom | head -c 8)
say "  图上画的随机串 $RS；对照组 $DECOY（图上没有，搜索必须 0 命中）"
BEFORE_RS=$(api_state | "$PY" -c 'import json,sys; print(max(n["id"] for n in json.load(sys.stdin)["notes"]))')
# jseval 钩子只在 .devmode 存在时干活（上一块末尾删了），不 touch 就是载荷根本没跑。
asroot_global "touch '$DATA/enote/.devmode'; chown '$UID_APP:$UID_APP' '$DATA/enote/.devmode'"
NOR=$(readtlog | wc -l)
ENOTE_RS="$RS" "$PY" -c 'import json,os,sys; print(json.dumps({"js": sys.argv[1].replace("@RS@", os.environ["ENOTE_RS"])}))' '(async function(){
  var L=function(m){console.log("OCRB64 "+m)};
  try{
    var c=document.createElement("canvas"); c.width=900; c.height=300;
    var g=c.getContext("2d");
    g.fillStyle="#ffffff"; g.fillRect(0,0,900,300);
    g.fillStyle="#000000"; g.textBaseline="top";
    g.font="bold 84px sans-serif"; g.fillText("取快递 @RS@", 40, 40);
    g.font="44px sans-serif"; g.fillText("图片文字搜索断言用唯一随机串", 40, 180);
    var b=(c.toDataURL("image/png").split(",")[1]||"");
    L("len="+b.length);
    for(var i=0;i<b.length;i+=1200){ L("d "+i+" "+b.slice(i,i+1200)) }
    L("done=1");
  }catch(e){ L("ERR="+(e&&e.message)); L("done=1") }
})()' > "$TMPDIR/jsocr.json"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsocr.json'"
NORTRIES=0
while [ "$NORTRIES" -lt 40 ]; do
  readtlog | tail -n +$((NOR + 1)) | grep -q 'OCRB64 done=1' && break
  sleep 0.5; NORTRIES=$((NORTRIES + 1))
done
readtlog | tail -n +$((NOR + 1)) | grep 'OCRB64 ' > "$TMPDIR/ocrb64.log"
"$PY" -c '
import base64, re, sys
lines = [l.rstrip("\\n") for l in open(sys.argv[1], encoding="utf-8", errors="replace")]
err = [l for l in lines if "OCRB64 ERR=" in l]
assert not err, "canvas 载荷抛异常：%s" % err[0]
parts = {}
for l in lines:
    m = re.search(r"OCRB64 d (\\d+) (.*)$", l)
    if m: parts[int(m.group(1))] = m.group(2).strip()
assert parts, "testlog 里没有 OCRB64 分片（载荷没跑？devmode 没开？）tries=%s" % sys.argv[3]
blob = "".join(parts[k] for k in sorted(parts))
m = re.search(r"OCRB64 len=(\\d+)", "\\n".join(lines))
assert m and int(m.group(1)) == len(blob), "分片拼出来 %d 字符，载荷说 %s：logcat 截断了" % (
    len(blob), m.group(1) if m else "?")
png = base64.b64decode(blob)
assert png[:8] == b"\\x89PNG\\r\\n\\x1a\\n", "解出来不是 PNG"
open(sys.argv[2], "wb").write(png)
print("  ok (canvas 现造 %s 字节的图，随机串已画进去)" % len(png))
' "$TMPDIR/ocrb64.log" "$HERE/.test/ocr-rand.png" "$NORTRIES" || fail "现造 OCR 图失败"
asroot_global "cp '$HERE/.test/ocr-rand.png' '$EXT/ocr-rand.png' && chown '$UID_APP:$UID_APP' '$EXT/ocr-rand.png' && chmod 644 '$EXT/ocr-rand.png'" \\
  || fail "cannot stage ocr-rand.png in $EXT"
am_start "$APP_PACKAGE/.ShareActivity" "-a android.intent.action.SEND -t 'image/*' --eu android.intent.extra.STREAM file://$EXT/ocr-rand.png"
# 轮询目标状态精确：这条笔记的 ocrText 里真的出现 RS（不是「OCR 跑过」就行）。
if ! wait_note "n['source']=='share-image' and n.get('ocrMs',0)>0 and '$RS' in (n.get('ocrText') or '') and n['id']>'$BEFORE_RS'" 150; then
  api_state | "$PY" -c '
import json,sys
ns = [n for n in json.load(sys.stdin)["notes"] if n["source"] == "share-image"]
ns.sort(key=lambda n: n["id"])
last = ns[-1] if ns else {}
print("  最近一条图片笔记：status=%s ocrMs=%s ocrText=%r" % (
    last.get("status"), last.get("ocrMs"), (last.get("ocrText") or "")[:120]))
'
  fail "OCR 没能在现造的图里读出 $RS（图上画的就是它：读不出就是本地 OCR 路径坏了）"
fi
printf '%s' "$LAST" | "$PY" -c '
import json,sys
n = json.load(sys.stdin)
print("  ok (OCR 逐字读出随机串，%d 字符 / %sms)" % (len(n["ocrText"]), n["ocrMs"]))
'
asroot_global "rm -f '$EXT/ocr-rand.png'" >/dev/null 2>&1 || true

'''

OLD_SEARCH = '''# q 用「取快递」：它同时出现在分享的文本里和 OCR 出来的图片文字里，
# 所以断言"命中来自图片文字"才有意义（图片 fixture 见 .test/ocr-test.png，
# 由 tools/crop_png.py 从 docs/shots 裁出来，换图就要同步这里的关键词）。
api_get "search?tab=notes&q=%E5%8F%96%E5%BF%AB%E9%80%92" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["ok"] and d["total"] >= 1, "q=取快递 matched nothing"
assert any("来自图片文字" in v for v in (d.get("where") or {}).values()), \\
  "no hit came from ocr text: %r" % d.get("where")
' || fail "search must match ocr text and label it 来自图片文字"
'''

NEW_SEARCH = '''# 「取快递」是共享关键词（分享的文本笔记里也有它）：这条只证明「文本命中 + 图片命中都能出标签」，
# 不证明命中只能来自图片文字（图片 fixture 见 .test/ocr-test.png，由 tools/crop_png.py 从
# docs/shots 裁出来，换图就要同步这里的关键词）。
api_get "search?tab=notes&q=%E5%8F%96%E5%BF%AB%E9%80%92" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["ok"] and d["total"] >= 1, "q=取快递 matched nothing"
assert any("来自图片文字" in v for v in (d.get("where") or {}).values()), \\
  "no hit came from ocr text: %r" % d.get("where")
' || fail "search must match ocr text and label it 来自图片文字"
# 收紧后的 OCR 搜索断言：q=$RS **只能由图片文字满足**。三条一起才算数：
#   1) src=text 必须 0 命中 —— 文本笔记（标题/正文/待办/标签）里没有它；
#   2) src=image 命中恰好 1 条，且这条命中的标签含「来自图片文字」（服务端按字段打标签）；
#   3) 对照组 q=$DECOY（同字符集、同长度、图上没画的随机串）必须 0 命中 —— 这条是套件里的
#      反向对照：它绿了才说明「命中 ≥1」不是恒绿（搜索实现坏了、什么都算命中时它必红）。
api_get "search?tab=notes&q=$RS&src=text" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["ok"] and d["total"] == 0, \\
  "q=%s 在 src=text 里有 %s 条命中：它不该出现在任何文本笔记里，这条断言就不是「只能由图片文字满足」" % (
    sys.argv[1], d.get("total"))
' "$RS" || fail "q=随机串 在 src=text 必须 0 命中"
api_get "search?tab=notes&q=$RS&src=image" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["ok"] and d["total"] == 1, \\
  "q=%s 在 src=image 命中 %s 条（应为 1 条：那条随机串图）" % (sys.argv[1], d.get("total"))
labels = [v for vs in (d.get("where") or {}).values() for v in vs]
assert "来自图片文字" in labels, \\
  "命中 %s 条但标签是 %r：没有一条来自 ocrText，随机串是从别的字段命中的" % (d.get("total"), labels)
' "$RS" || fail "q=随机串 必须命中那条随机串图并标为 来自图片文字"
api_get "search?tab=notes&q=$DECOY" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["ok"] and d["total"] == 0, \\
  "对照组 q=%s（图上没有的随机串）命中 %s 条：搜索什么都算命中的话，上面那条断言就是恒绿" % (
    sys.argv[1], d.get("total"))
' "$DECOY" || fail "对照组随机串必须 0 命中（反向对照）"
'''

assert s.count(NEW_STEP.strip()) == 0, "新步骤已存在"
assert s.count(OLD_SEARCH) == 1, "搜索断言锚点没找到"
i = s.index('step "todo add / toggle / delete"')
s = s[:i] + NEW_STEP.lstrip("\n") + s[i:]
s = s.replace(OLD_SEARCH, NEW_SEARCH)
io.open(P, "w", encoding="utf-8").write(s)
print("ok")
