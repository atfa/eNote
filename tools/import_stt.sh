#!/data/data/com.termux/files/usr/bin/bash
# Import the offline STT engine from ../stt (vivo offline ASR) into this project.
#
# What it does:
#   1. copies stt/vivoasr/jniLibs/arm64-v8a/*.so        -> jniLibs/arm64-v8a/  (with rename)
#   2. copies stt/vivoasr/assets/model/*                -> assets/stt/model/  (the 15 model files)
#   3. copies the reversed JNI shells (ASR.java, a.java) -> src/com/vivo/speechsdk/module/asroffline/
#   4. copies testdata/zh.wav and the reference test script -> .test/stt/ (for eNote's test.sh)
#   5. resolves the libvcap_core.so name clash with the OCR engine:
#        * OCR ships its own libvcap_core.so (different build) - both must coexist in the apk.
#        * the STT .so files that NEEDED "libvcap_core.so" get that reference rewritten,
#          and the STT libvcap_core.so is renamed to libvcap_cstt.so so the two never collide.
#      (Same-length byte patch of the ELF .dynstr/DYNAMIC tables, so the files stay valid.)
#   6. tombstone=MODULE_DISALLOWED:
#      (android:extractNativeLibs="true" keeps the .so readable, non-exec: loader maps it directly,
#       dlopen by absolute path works on non-vivo too. IMPORTANT: never extractNativeLibs="false".)
#
# The import is re-runnable; existing files are overwritten.

set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${STT_SRC:-../stt/vivoasr}"
DEST_LIB=jniLibs/arm64-v8a
DEST_MODEL=assets/stt/model
DEST_JAVA=src/com/vivo/speechsdk/module/asroffline
DEST_TEST=.test/stt

[ -d "$SRC/jniLibs/arm64-v8a" ] || { echo "no STT src at $SRC"; exit 1; }

echo "==> copying native libs"
mkdir -p "$DEST_LIB"
for f in "$SRC"/jniLibs/arm64-v8a/*.so; do
  b=$(basename "$f")
  if [ "$b" = "libvcap_core.so" ]; then
    cp "$f" "$DEST_LIB/libvcap_cstt.so"
  else
    cp "$f" "$DEST_LIB/$b"
  fi
done

echo "==> copying models"
mkdir -p "$DEST_MODEL"
cp "$SRC"/assets/model/* "$DEST_MODEL/"

echo "==> copying JNI shell java"
mkdir -p "$DEST_JAVA"
cp "$SRC"/src/com/vivo/speechsdk/module/asroffline/ASR.java "$DEST_JAVA/"
cp "$SRC"/src/com/vivo/speechsdk/module/asroffline/a.java "$DEST_JAVA/"

echo "==> copying test files"
mkdir -p "$DEST_TEST"
[ -f "$SRC/testdata/zh.wav" ] && cp "$SRC/testdata/zh.wav" "$DEST_TEST/"
[ -f "$SRC/test.sh" ] && cp "$SRC/test.sh" "$DEST_TEST/stt-ref.sh"

# ---- rewrite vcap references (only STT files we just copied) ----
echo "==> renaming libvcap_core.so -> libvcap_cstt.so inside STT .so metadata"
python3 - <<'EOF'
import struct, sys

def patch(path):
    with open(path,'rb') as f: data=f.read()
    if data[:4]!=b'\x7fELF': return "not ELF"
    is64 = data[4]==2
    e_shoff = struct.unpack_from('<Q',data,0x28)[0]
    e_shentsize = struct.unpack_from('<H',data,0x3a)[0]
    e_shnum = struct.unpack_from('<H',data,0x3c)[0]
    e_shstrndx = struct.unpack_from('<H',data,0x3e)[0]
    def sec(name):
        shstr_off = struct.unpack_from('<Q',data,e_shoff+e_shstrndx*e_shentsize+0x18)[0]
        shstr_size = struct.unpack_from('<Q',data,e_shoff+e_shstrndx*e_shentsize+0x20)[0]
        shstr = data[shstr_off:shstr_off+shstr_size]
        for i in range(e_shnum):
            o = e_shoff+i*e_shentsize
            no = struct.unpack_from('<I',data,o)[0]
            nm = shstr[no:shstr.index(b'\0',no)]
            if nm==name:
                so = struct.unpack_from('<Q',data,o+0x18)[0]
                sz = struct.unpack_from('<Q',data,o+0x20)[0]
                return so,sz
        return None
    d = sec(b'.dynstr')
    if not d: return "no .dynstr"
    so,sz = d
    tbl = data[so:so+sz]
    o = b'libvcap_core.so'
    n = b'libvcap_cstt.so'
    if len(o)!=len(n): return "len mismatch"
    c = tbl.count(o)
    if c==0: return "not referenced"
    if c>1: return f"{c} refs, abort"
    # overwrite the exact bytes (equal length: same offsets, same file size)
    idx = tbl.index(o)
    data = data[:so+idx] + n + data[so+idx+len(o):]
    with open(path,'wb') as f: f.write(data)
    return "patched"

import os
targets = [
 "jniLibs/arm64-v8a/libvcap_cstt.so",
 "jniLibs/arm64-v8a/libvasr.so",
 "jniLibs/arm64-v8a/libvcap_arm82.so",
]
ok=True
for t in targets:
    r = patch(t)
    print(f"  {t}: {r}")
    if r!="patched": ok=False
sys.exit(0 if ok else 1)
EOF

echo "==> done"
ls -la "$DEST_LIB" | tail -3
echo "STT model files: $(ls "$DEST_MODEL" | wc -l)"