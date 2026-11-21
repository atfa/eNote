// Business logic in Go, exposed to Java over JNI.
//
// Build: ./build.sh (it runs go build -buildmode=c-shared and puts the .so into the apk).
//
// Exported functions are named Java_<package with . replaced by _>_<class>_<method>, which is
// what the Android runtime looks up for a `native` method - no RegisterNatives, no C shim.
// cgo cannot call JNIEnv's function-pointer table from Go, so the JNI operations needed are
// wrapped in static C helpers below.
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

// Go -> Java: call obj.onGoCallback(String). Cache the jmethodID in JNI_OnLoad in a real app.
static int jCallOnGoCallback(JNIEnv *env, jobject obj, const char *msg) {
    jclass cls = (*env)->GetObjectClass(env, obj);
    if (cls == NULL) return -1;
    jmethodID mid = (*env)->GetMethodID(env, cls, "onGoCallback", "(Ljava/lang/String;)V");
    if (mid == NULL) { (*env)->ExceptionClear(env); return -2; }
    jstring s = (*env)->NewStringUTF(env, msg);
    (*env)->CallVoidMethod(env, obj, mid, s);
    if ((*env)->ExceptionCheck(env)) { (*env)->ExceptionClear(env); return -3; }
    return 0;
}

// A goroutine that outlives the JNI call needs a global ref, and a thread created by the Go
// scheduler must be attached to the JVM before it may touch JNIEnv.
static jobject jNewGlobalRef(JNIEnv *env, jobject o) { return (*env)->NewGlobalRef(env, o); }
static void jDelGlobalRef(JNIEnv *env, jobject o) { (*env)->DeleteGlobalRef(env, o); }
static int jGetJavaVM(JNIEnv *env, JavaVM **vm) { return (*env)->GetJavaVM(env, vm); }
static int jAttach(JavaVM *vm, JNIEnv **env) {
    JavaVMAttachArgs args;
    args.version = JNI_VERSION_1_6;
    args.name = (char *) "go-worker";
    args.group = NULL;
    return (*vm)->AttachCurrentThread(vm, env, &args);
}
static int jDetach(JavaVM *vm) { return (*vm)->DetachCurrentThread(vm); }
*/
import "C"
import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
	"unsafe"
)

// ===========================================================================
// Pure Go - no cgo in here, so `go test` runs it on any host and on the phone.
// ===========================================================================

func fib(n int) int {
	if n < 2 {
		return n
	}
	return fib(n-1) + fib(n-2)
}

var (
	mu    sync.Mutex
	store = map[string]string{}
)

func put(k string) string {
	mu.Lock()
	defer mu.Unlock()
	store[k] = k + "->from-go"
	return store[k]
}

func info() string {
	return fmt.Sprintf("go=%s os=%s arch=%s cgo=1 goroutines=%d gomaxprocs=%d",
		runtime.Version(), runtime.GOOS, runtime.GOARCH,
		runtime.NumGoroutine(), runtime.GOMAXPROCS(0))
}

func benchmark(n int) map[string]any {
	out := map[string]any{"go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH}
	t := time.Now()
	out["fib"] = map[string]any{"n": n, "value": fib(n), "ns": time.Since(t).Nanoseconds()}
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	out["mem"] = map[string]any{"heapAlloc": ms.HeapAlloc, "sys": ms.Sys, "numGC": ms.NumGC}
	return out
}

// ===========================================================================
// JNI bridge. Every export recovers(): a Go panic that reaches the JVM kills the
// process (SIGABRT) and Java cannot catch it.
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

// guard runs f and turns a Go panic into an error string instead of a dead process.
func guard(env *C.JNIEnv, what string, f func() C.jstring) (out C.jstring) {
	defer func() {
		if p := recover(); p != nil {
			fmt.Fprintf(os.Stderr, "%s panicked: %v\n", what, p)
			out = s2j(env, "panic in "+what)
		}
	}()
	return f()
}

//export Java___PKG_UNDERSCORE___MainActivity_nativeInfo
func Java___PKG_UNDERSCORE___MainActivity_nativeInfo(env *C.JNIEnv, cls C.jclass) C.jstring {
	return s2j(env, info())
}

//export Java___PKG_UNDERSCORE___MainActivity_nativeFib
func Java___PKG_UNDERSCORE___MainActivity_nativeFib(env *C.JNIEnv, cls C.jclass, n C.jint) C.jlong {
	return C.jlong(fib(int(n)))
}

//export Java___PKG_UNDERSCORE___MainActivity_nativePut
func Java___PKG_UNDERSCORE___MainActivity_nativePut(env *C.JNIEnv, cls C.jclass, js C.jstring) C.jstring {
	return s2j(env, put(j2s(env, js)))
}

//export Java___PKG_UNDERSCORE___MainActivity_nativeBenchmark
func Java___PKG_UNDERSCORE___MainActivity_nativeBenchmark(env *C.JNIEnv, cls C.jclass, n C.jint) C.jstring {
	return js2j(env, benchmark(int(n)))
}

// nativeWriteFile: Go writes into the app's own files dir (path passed in by Java).
//
//export Java___PKG_UNDERSCORE___MainActivity_nativeWriteFile
func Java___PKG_UNDERSCORE___MainActivity_nativeWriteFile(env *C.JNIEnv, cls C.jclass, js C.jstring) C.jstring {
	return guard(env, "writeFile", func() C.jstring {
		p := filepath.Join(j2s(env, js), "from-go.txt")
		body := fmt.Sprintf("written by %s at %s\n", runtime.Version(), time.Now().Format(time.RFC3339))
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			return s2j(env, "write failed: "+err.Error())
		}
		st, _ := os.Stat(p)
		return s2j(env, fmt.Sprintf("wrote %s (%d bytes)", p, st.Size()))
	})
}

// nativeCallback calls back into Java: obj.onGoCallback("...").
//
//export Java___PKG_UNDERSCORE___MainActivity_nativeCallback
func Java___PKG_UNDERSCORE___MainActivity_nativeCallback(env *C.JNIEnv, cls C.jclass, obj C.jobject) C.jint {
	msg := C.CString(fmt.Sprintf("hello from Go (%s, %d goroutines)",
		runtime.Version(), runtime.NumGoroutine()))
	defer C.free(unsafe.Pointer(msg))
	return C.jint(C.jCallOnGoCallback(env, obj, msg))
}

// nativeAsyncCallback finishes *after* the JNI call returned: global ref + attach +
// delete-before-detach, the three things that abort the process when done wrong.
//
//export Java___PKG_UNDERSCORE___MainActivity_nativeAsyncCallback
func Java___PKG_UNDERSCORE___MainActivity_nativeAsyncCallback(env *C.JNIEnv, cls C.jclass, obj C.jobject, ms C.jint) C.jstring {
	global := C.jNewGlobalRef(env, obj)
	var vm *C.JavaVM
	if C.jGetJavaVM(env, &vm) != 0 || vm == nil {
		C.jDelGlobalRef(env, global)
		return s2j(env, "GetJavaVM failed")
	}
	delay := time.Duration(int(ms)) * time.Millisecond
	go func() {
		time.Sleep(delay)
		var jenv *C.JNIEnv
		if C.jAttach(vm, &jenv) != 0 {
			fmt.Fprintln(os.Stderr, "AttachCurrentThread failed")
			return
		}
		msg := C.CString(fmt.Sprintf("async callback after %v", delay))
		rc := C.jCallOnGoCallback(jenv, global, msg)
		C.free(unsafe.Pointer(msg))
		C.jDelGlobalRef(jenv, global) // with the ATTACHED env, before detaching
		C.jDetach(vm)
		fmt.Fprintf(os.Stderr, "async callback rc=%d\n", rc)
	}()
	return s2j(env, fmt.Sprintf("goroutine started, will call back in %v", delay))
}

// nativeStartServer starts the Go HTTP server (web.go) and returns the URL for a WebView.
//
//export Java___PKG_UNDERSCORE___MainActivity_nativeStartServer
func Java___PKG_UNDERSCORE___MainActivity_nativeStartServer(env *C.JNIEnv, cls C.jclass) C.jstring {
	return s2j(env, startWebServer())
}

// nativeWebSelfTest proves the HTTP loop works from Go alone, no WebView needed.
//
//export Java___PKG_UNDERSCORE___MainActivity_nativeWebSelfTest
func Java___PKG_UNDERSCORE___MainActivity_nativeWebSelfTest(env *C.JNIEnv, cls C.jclass) C.jstring {
	return s2j(env, selfTest())
}

func main() {}
