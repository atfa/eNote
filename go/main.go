// eNote - business logic in Go, exposed to Java over JNI.
//
// Build: ./build.sh (go build -buildmode=c-shared -> lib/arm64-v8a/libenote.so).
//
// Java is a thin shell: WebView, share intents, the vivo OCR engine. Everything else -
// storage, the LLM call, the HTTP API and the HTML UI - is Go.
//
// Exported names are Java_<package with . -> _>_<class>_<method>, which is what the runtime
// looks up for a `native` method. cgo cannot call JNIEnv's function-pointer table, so the
// few JNI operations needed are wrapped in the C helpers below.
package main

/*
#include <jni.h>
#include <stdlib.h>

static int jisNull(JNIEnv *env, jstring s) { return s == NULL; }

static jstring jNewString(JNIEnv *env, const char *s) {
    return (*env)->NewStringUTF(env, s);
}

static char *jGetChars(JNIEnv *env, jstring s) {
    return (char *) (*env)->GetStringUTFChars(env, s, NULL);
}

static void jRelChars(JNIEnv *env, jstring s, char *c) {
    (*env)->ReleaseStringUTFChars(env, s, c);
}
*/
import "C"
import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"unsafe"
)

// ===========================================================================
// JNI bridge helpers
// ===========================================================================

func j2s(env *C.JNIEnv, js C.jstring) string {
	if C.jisNull(env, js) == 1 {
		return ""
	}
	c := C.jGetChars(env, js)
	s := C.GoString(c)
	C.jRelChars(env, js, c)
	return s
}

func s2j(env *C.JNIEnv, s string) C.jstring {
	cs := C.CString(s)
	defer C.free(unsafe.Pointer(cs))
	return C.jNewString(env, cs)
}

func js2j(env *C.JNIEnv, v any) C.jstring {
	b, err := json.Marshal(v)
	if err != nil {
		return s2j(env, `{"error":"`+err.Error()+`"}`)
	}
	return s2j(env, string(b))
}

// guard runs f and turns a Go panic into an error string: a panic that reaches the JVM
// aborts the process and Java cannot catch it.
func guard(env *C.JNIEnv, what string, f func() C.jstring) (out C.jstring) {
	defer func() {
		if p := recover(); p != nil {
			logf("PANIC in %s: %v", what, p)
			out = s2j(env, `{"error":"panic in `+what+`"}`)
		}
	}()
	return f()
}

// ===========================================================================
// JNI exports (class dev.xduo.enote.Bridge)
// ===========================================================================

// nativeInit(filesDir, tzOffsetSec, tzId) - called from Application.onCreate. Pins the Go
// clock to the device's wall clock (the Android Go runtime has no tzdata, so time.Now()
// would report UTC and every "overdue" / day-bucket comparison would drift), then loads
// config, opens the store and starts the ingest worker. Returns a status JSON.
//
//export Java_dev_xduo_enote_Bridge_nativeInit
func Java_dev_xduo_enote_Bridge_nativeInit(env *C.JNIEnv, cls C.jclass, jdir C.jstring,
	offSec C.jint, jtz C.jstring) C.jstring {
	return guard(env, "nativeInit", func() C.jstring {
		dir := j2s(env, jdir)
		if dir == "" {
			return s2j(env, `{"ok":false,"error":"empty filesDir"}`)
		}
		applyTZ(int(offSec), j2s(env, jtz))
		return js2j(env, appInit(dir))
	})
}

// nativeStartServer() - starts the HTTP server (idempotent) and returns its URL.
//
//export Java_dev_xduo_enote_Bridge_nativeStartServer
func Java_dev_xduo_enote_Bridge_nativeStartServer(env *C.JNIEnv, cls C.jclass) C.jstring {
	return guard(env, "nativeStartServer", func() C.jstring {
		return s2j(env, startWebServer())
	})
}

// nativeEnqueue(payloadJSON) - Java hands over shared text or an image (+ its OCR text).
// Returns the created note id so the UI can scroll to it.
//
//export Java_dev_xduo_enote_Bridge_nativeEnqueue
func Java_dev_xduo_enote_Bridge_nativeEnqueue(env *C.JNIEnv, cls C.jclass, js C.jstring) C.jstring {
	return guard(env, "nativeEnqueue", func() C.jstring {
		return js2j(env, enqueueRaw(j2s(env, js)))
	})
}

// nativeClipAdd(payloadJSON) - the clipboard watcher holds text/image back here (R7, P6).
// payload: {"kind":"text|image","text":...,"path":...,"name":...,"mime":...,"app":...}
// De-dupe happens inside clipAdd; nothing is parsed yet.
//
//export Java_dev_xduo_enote_Bridge_nativeClipAdd
func Java_dev_xduo_enote_Bridge_nativeClipAdd(env *C.JNIEnv, cls C.jclass, js C.jstring) C.jstring {
	return guard(env, "nativeClipAdd", func() C.jstring {
		var r struct {
			Kind string `json:"kind"`
			Text string `json:"text"`
			Path string `json:"path"`
			Name string `json:"name"`
			MIME string `json:"mime"`
			App  string `json:"app"`
		}
		_ = json.Unmarshal([]byte(j2s(env, js)), &r)
		return s2j(env, clipAdd(r.Kind, r.Text, r.Path, r.Name, r.MIME, r.App))
	})
}

// nativeClipCount() - how many clipboard items are still held back, for the foreground
// notification badge and the UI strip.
//
//export Java_dev_xduo_enote_Bridge_nativeClipCount
func Java_dev_xduo_enote_Bridge_nativeClipCount(env *C.JNIEnv, cls C.jclass) C.jint {
	return C.jint(clipCount())
}

// nativeSetOcr(ready, info) - Java reports the OCR engine state (init result, version).
//
//export Java_dev_xduo_enote_Bridge_nativeSetOcr
func Java_dev_xduo_enote_Bridge_nativeSetOcr(env *C.JNIEnv, cls C.jclass, ready C.jboolean, js C.jstring) {
	setOCR(ready != 0, j2s(env, js))
}

// nativeNoteImage(id) - the stored image path of a note, so Java can re-run OCR on it.
//
//export Java_dev_xduo_enote_Bridge_nativeNoteImage
func Java_dev_xduo_enote_Bridge_nativeNoteImage(env *C.JNIEnv, cls C.jclass, js C.jstring) C.jstring {
	return guard(env, "nativeNoteImage", func() C.jstring {
		n := store.get(j2s(env, js))
		if n == nil {
			return s2j(env, "")
		}
		return s2j(env, n.ImagePath)
	})
}

// nativeReminders() - pending due reminders read straight from the store, so the
// optional foreground service can rebuild the alarm set with no WebView alive.
//
//export Java_dev_xduo_enote_Bridge_nativeReminders
func Java_dev_xduo_enote_Bridge_nativeReminders(env *C.JNIEnv, cls C.jclass) C.jstring {
	return guard(env, "nativeReminders", func() C.jstring {
		if store == nil {
			return s2j(env, "[]")
		}
		return js2j(env, store.pendingReminders())
	})
}

// nativeStatus() - diagnostics for `am start --es hook status` and the debug tab.
//
//export Java_dev_xduo_enote_Bridge_nativeStatus
func Java_dev_xduo_enote_Bridge_nativeStatus(env *C.JNIEnv, cls C.jclass) C.jstring {
	return guard(env, "nativeStatus", func() C.jstring {
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		return js2j(env, map[string]any{
			"go":          runtime.Version(),
			"os":          runtime.GOOS,
			"arch":        runtime.GOARCH,
			"goroutines":  runtime.NumGoroutine(),
			"heapAllocKB": ms.HeapAlloc / 1024,
			"server":      srvURL,
			"app":         appInfo(),
		})
	})
}

// nativeSelfTest(json) - headless end-to-end check driven from `am start --es hook ...`:
// store round trip, LLM call, JSON parsing. No WebView needed.
//
//export Java_dev_xduo_enote_Bridge_nativeSelfTest
func Java_dev_xduo_enote_Bridge_nativeSelfTest(env *C.JNIEnv, cls C.jclass, js C.jstring) C.jstring {
	return guard(env, "nativeSelfTest", func() C.jstring {
		return js2j(env, selfTest(j2s(env, js)))
	})
}

func main() {}

func init() {
	// logcat is muted on this device (persist.sys.log.ctrl=no); stderr also goes nowhere
	// useful, so the Go side keeps its own log file inside the app's files dir.
	fmt.Fprintln(os.Stderr, "enote: lib loaded")
}
