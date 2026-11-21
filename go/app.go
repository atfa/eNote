package main

import "runtime"

var (
	goVersionString = runtime.Version()
	ocrReady        bool // set by Java once the vivo OCR engine has initialised
	ocrInfo         = ""
)

// setOCR lets Java report the OCR engine state so the UI can show it and the debug tab
// can tell "no text in image" apart from "engine never started".
func setOCR(ready bool, info string) {
	ocrReady, ocrInfo = ready, info
	logf("ocr state: ready=%v %s", ready, info)
}
