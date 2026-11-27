package main

import "os"

// 一个进程里住着两个 vivo 引擎：离线 OCR（libvcap_core.so）和离线语音（libvcap_cstt.so）。
// 这两份 .so 各自**静态链了一份 LLVM OpenMP**（同一个 runtime，两份拷贝）。第二个 runtime
// 初始化时会走 libomp 的重复检测，直接：
//
//	OMP: Error #15: Initializing libomp.so, but found libomp.so already initialized.
//	... abort()
//
// 症状就是打开 app 两秒内 SIGABRT，回溯只有 libc abort → libvcap_cstt.so(__kmp_abort_process)，
// 什么都看不出来；关掉 OCR 初始化它就正常，所以很容易误判成「模型/改名/权限」问题。
//
// 这里在 Go 侧初始化（libenote.so 由 Bridge.init 在 Application.onCreate 里最先加载，
// 早于两个引擎各自的 initAsync）先把 libomp 自己文档里给的逃生阀打开：允许两份 runtime
// 共存。两个引擎各自只在自己的 .so 里用自己的那份，实测 OCR 与语音在同一次运行里都正常。
//
// 约束：必须在任何引擎库 dlopen 之前执行，所以只能放在 libenote.so 的 init 里——
// Java 侧没有 setenv，Application 里也排不到 Java 代码之前。
func init() {
	// 失败也不致命：最坏情况就是回到 Error #15（第二个引擎起不来），而不是静默坏掉。
	_ = os.Setenv("KMP_DUPLICATE_LIB_OK", "TRUE")
}
