#!/usr/bin/env python3
"""Dump the JNINativeMethod tables out of an Android JNI library.

Used to recover the exact method names/signatures that libperfetto_framework_jni.so registers,
so the PerfettoTrace stub for Termux's OpenJDK matches them (RegisterNatives is all-or-nothing:
one mismatch and the JVM aborts at startup).

It reads the ELF by hand (no pyelftools on Termux): .data.rel.ro holds the tables, and on
Android the slots already contain vaddrs (RELR relocations), so no relocation processing is
needed for a static look at the file.
"""
import re
import struct
import sys

PT_LOAD = 1
SHT_PROGBITS, SHT_RELA = 1, 4


class Elf:
    def __init__(self, path):
        self.d = open(path, "rb").read()
        d = self.d
        assert d[:4] == b"\x7fELF" and d[4] == 2, "need ELF64"
        # ELF64 header: e_ident(16) type(2) machine(2) version(4) entry(8) phoff(8) shoff(8)
        self.e_phoff = struct.unpack_from("<Q", d, 0x20)[0]
        self.e_shoff = struct.unpack_from("<Q", d, 0x28)[0]
        self.e_shentsize = struct.unpack_from("<H", d, 0x3A)[0]
        self.e_shnum = struct.unpack_from("<H", d, 0x3C)[0]
        self.e_shstrndx = struct.unpack_from("<H", d, 0x3E)[0]
        self.loads = []
        for i in range(struct.unpack_from("<H", d, 0x38)[0]):
            o = self.e_phoff + i * struct.unpack_from("<H", d, 0x36)[0]
            p_type, = struct.unpack_from("<I", d, o)
            if p_type != PT_LOAD:
                continue
            p_offset = struct.unpack_from("<Q", d, o + 8)[0]
            p_vaddr = struct.unpack_from("<Q", d, o + 16)[0]
            p_filesz = struct.unpack_from("<Q", d, o + 32)[0]
            self.loads.append((p_offset, p_vaddr, p_filesz))
        self.sections = {}
        shstr = self._section_by_index(self.e_shstrndx)
        for i in range(self.e_shnum):
            o = self.e_shoff + i * self.e_shentsize
            sh_name, sh_type = struct.unpack_from("<II", d, o)
            sh_addr, sh_offset, sh_size = struct.unpack_from("<QQQ", d, o + 16)
            name = self._cstr(shstr[0] + sh_name).decode("ascii", "replace")
            self.sections[name] = (sh_addr, sh_offset, sh_size, sh_type)
        # R_AARCH64_RELATIVE relocations: the runtime pointer value is the addend (bias 0), and
        # the file slot itself is zero, so a plain file scan misses them.
        self.rela = {}
        if ".rela.dyn" in self.sections:
            a, o, size, _ = self.sections[".rela.dyn"]
            for i in range(size // 24):
                r_offset, r_info, r_addend = struct.unpack_from("<QQq", d, o + i * 24)
                if (r_info & 0xffffffff) == 1027:      # R_AARCH64_RELATIVE
                    self.rela[r_offset] = r_addend

    def slot(self, vaddr):
        """Pointer stored at vaddr, after relocations (load bias 0)."""
        v = self.ptr(self.at(vaddr))
        if v:
            return v
        return self.rela.get(vaddr, 0)

    def _section_by_index(self, i):
        o = self.e_shoff + i * self.e_shentsize
        sh_name, sh_type = struct.unpack_from("<II", self.d, o)
        sh_addr, sh_offset, sh_size = struct.unpack_from("<QQQ", self.d, o + 16)
        return (sh_offset, sh_addr, sh_size, sh_type)

    def _cstr(self, off):
        end = self.d.index(b"\0", off)
        return self.d[off:end]

    def at(self, vaddr):
        for off, va, sz in self.loads:
            if va <= vaddr < va + sz:
                return off + (vaddr - va)
        return None

    def ptr(self, file_off):
        if file_off is None or file_off + 8 > len(self.d):
            return None
        return struct.unpack_from("<Q", self.d, file_off)[0]

    def cstr(self, vaddr, limit=200):
        o = self.at(vaddr)
        if o is None:
            return None
        end = self.d.index(b"\0", o, min(len(self.d), o + limit))
        s = self.d[o:end]
        try:
            s.decode("ascii")
        except UnicodeDecodeError:
            return None
        return s.decode("ascii")


IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")


def tables(path):
    e = Elf(path)
    addr, off, size, _ = e.sections[".data.rel.ro"]
    out = []
    cur = []
    i = 0
    while i + 24 <= size:
        vaddr = addr + i
        a = e.slot(vaddr)
        b = e.slot(vaddr + 8)
        c = e.slot(vaddr + 16)
        name = e.cstr(a) if a else None
        sig = e.cstr(b) if b else None
        if (name and sig and IDENT.match(name) and sig.startswith("(")
                and c and e.at(c) is not None):
            cur.append((name, sig))
            i += 24
            continue
        if len(cur) >= 2:
            out.append(cur)
        cur = []
        i += 8
    if len(cur) >= 2:
        out.append(cur)
    return out


def main():
    import os
    cands = ("/system/lib64/libperfetto_framework_jni.so",
             "/system/lib/libperfetto_framework_jni.so",
             "/apex/com.android.runtime/lib64/libperfetto_framework_jni.so",
             "/apex/com.android.runtime/lib/libperfetto_framework_jni.so")
    default = os.environ.get("PERFETTO_JNI_LIB") or \
        next((c for c in cands if os.path.exists(c)), cands[0])
    path = sys.argv[1] if len(sys.argv) > 1 else default
    ts = tables(path)
    print("%s: %d tables" % (path, len(ts)))
    allpairs = set()
    for n, t in enumerate(ts):
        print("---- table %d (%d methods)" % (n, len(t)))
        for name, sig in t:
            print("     %-40s %s" % (name, sig))
            allpairs.add((name, sig))
    print("total distinct methods: %d" % len(allpairs))


if __name__ == "__main__":
    main()
