#!/usr/bin/env python3
"""Make Termux's OpenJDK usable: write a stub jar for the Perfetto JNI registration.

Termux ships OpenJDK as a *native Android* binary. Its JNI_OnLoad (in the system's
libperfetto_framework_jni.so) does FindClass("com.android.internal.dev.perfetto.sdk.PerfettoTrace")
and RegisterNatives() against that class - a class that only exists in the Android framework -
so every JVM tool dies at startup with

    Native registration unable to find class
    'com/android/internal/dev/perfetto/sdk/PerfettoTrace'; aborting...
    Unable to register perfetto native methods.

`java -version` slips through; `javac`/`jar`/`keytool` abort (exit 134).

Fix: a stub jar declaring those classes with the exact native methods the registration table
expects (RegisterNatives is all-or-nothing: one mismatched signature and it still aborts), put
on the boot classpath:

    javac -J-Xbootclasspath/a:$ANDROID_TOOLS/perfetto-stub.jar ...
    java  -Xbootclasspath/a:$ANDROID_TOOLS/perfetto-stub.jar ...

The class list and the method table are read out of the device's own library, so the stub
matches the Android build it is installed on. The class file bytes are written by hand - there
is no working compiler, that is the whole problem.

Usage: python3 fix-termux-javac.py [output.jar]
       PERFETTO_JNI_LIB=/path/libperfetto_framework_jni.so ...   override the library
"""
import os
import struct
import sys
import zipfile

PREFIX = "com/android/internal/dev/perfetto/sdk/"

# 64-bit devices have both, 32-bit devices only the second one.
CANDIDATES = (
    "/system/lib64/libperfetto_framework_jni.so",
    "/system/lib/libperfetto_framework_jni.so",
    "/apex/com.android.runtime/lib64/libperfetto_framework_jni.so",
    "/apex/com.android.runtime/lib/libperfetto_framework_jni.so",
)


def find_lib():
    explicit = os.environ.get("PERFETTO_JNI_LIB")
    if explicit:
        return explicit
    for p in CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def discover(lib):
    """(class names, method name/signature pairs) taken from the JNI library itself."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import re
    from dumpjni import Elf

    e = Elf(lib)
    names, methods = [], set()
    for s in sorted(set(re.findall(rb"[\x20-\x7e]{4,}", e.d))):
        s = s.decode()
        if s.startswith(PREFIX):
            names.append(s)
    for table in tables_of(e):
        methods.update(table)
    return names, sorted(methods)


def tables_of(e):
    """All JNINativeMethod tables in .data.rel.ro (see dumpjni.py)."""
    import re

    ident = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
    addr, off, size, _ = e.sections[".data.rel.ro"]
    out, cur = [], []
    i = 0
    while i + 24 <= size:
        a, b, c = e.slot(addr + i), e.slot(addr + i + 8), e.slot(addr + i + 16)
        name, sig = (e.cstr(a) if a else None), (e.cstr(b) if b else None)
        if name and sig and ident.match(name) and sig.startswith("(") and c and e.at(c):
            cur.append((name, sig))
            i += 24
        else:
            if len(cur) >= 2:
                out.append(cur)
            cur = []
            i += 8
    if len(cur) >= 2:
        out.append(cur)
    return out


def class_bytes(this_internal, methods):
    """A public abstract class holding these public static native methods (Java 8 bytecode)."""
    pool = []

    def add(raw):
        pool.append(raw)
        return len(pool)

    def utf8(s):
        return add(struct.pack(">BH", 1, len(s.encode())) + s.encode())

    def cls(i):
        return add(struct.pack(">BH", 7, i))

    i_this = cls(utf8(this_internal))
    i_super = cls(utf8("java/lang/Object"))
    ms = []
    for name, desc in methods:
        ms.append((0x0001 | 0x0008 | 0x0100, utf8(name), utf8(desc)))   # public static native
    out = bytearray()
    out += struct.pack(">IHH", 0xCAFEBABE, 0, 52)
    out += struct.pack(">H", len(pool) + 1)
    for raw in pool:
        out += raw
    out += struct.pack(">HHH", 0x0401, i_this, i_super)      # public abstract
    out += struct.pack(">HH", 0, 0)                          # interfaces, fields
    out += struct.pack(">H", len(ms))
    for acc, ni, di in ms:
        out += struct.pack(">HHHH", acc, ni, di, 0)
    out += struct.pack(">H", 0)                              # class attributes
    return bytes(out)


def main():
    default = os.path.join(os.environ.get("ANDROID_TOOLS",
                                          os.path.expanduser("~/android-tools")),
                           "perfetto-stub.jar")
    out = sys.argv[1] if len(sys.argv) > 1 else default
    lib = find_lib()
    if not lib:
        sys.exit("no libperfetto_framework_jni.so found (tried %s) - is this an Android device?"
                 % ", ".join(CANDIDATES))
    names, methods = discover(lib)
    if not names or not methods:
        sys.exit("found nothing in %s - is this an Android device?" % lib)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n + ".class", class_bytes(n, methods))
    print("wrote %s: %d classes, %d native methods each (from %s)"
          % (out, len(names), len(methods), lib))
    print("use:  javac -J-Xbootclasspath/a:%s ..." % out)
    print("      java  -Xbootclasspath/a:%s -cp ..." % out)


if __name__ == "__main__":
    main()
