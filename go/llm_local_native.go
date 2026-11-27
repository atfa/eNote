//go:build android && arm64 && enote_llama

package main

/*
#include <stdlib.h>
#include "../native/llama/engine.h"
*/
import "C"

import (
	"errors"
	"strings"
	"unsafe"
)

const localEngineAvailable = true

func unloadLocalModel() { C.enote_llama_unload() }

func localStage(path string) string {
	file := C.CString(path)
	defer C.free(unsafe.Pointer(file))
	switch C.enote_llama_stage(file) {
	case C.ENOTE_LOADING:
		return "loading"
	case C.ENOTE_PREFILL:
		return "prefill"
	case C.ENOTE_GENERATING:
		return "generating"
	case C.ENOTE_LOADED:
		return "loaded"
	default:
		return "unloaded"
	}
}

func inferLocal(path, system, user string, maxTokens int, temperature float64, timeout int) (string, string, error) {
	// C strings cannot carry an embedded NUL. Keep the text after it visible to the model.
	model := C.CString(path)
	sys := C.CString(strings.ReplaceAll(system, "\x00", "�"))
	usr := C.CString(strings.ReplaceAll(user, "\x00", "�"))
	defer C.free(unsafe.Pointer(model))
	defer C.free(unsafe.Pointer(sys))
	defer C.free(unsafe.Pointer(usr))
	var status C.int
	result := C.enote_llama_generate(model, sys, usr, C.int(maxTokens), C.double(temperature), C.int(timeout), &status)
	if result == nil {
		return "", "", errors.New("无法分配推理结果")
	}
	defer C.free(unsafe.Pointer(result))
	text := strings.ToValidUTF8(C.GoString(result), "�")
	if status < 0 {
		return "", "", errors.New(text)
	}
	if status == 1 {
		return text, "length", nil
	}
	return text, "stop", nil
}
