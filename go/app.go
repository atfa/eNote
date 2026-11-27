package main

import (
	"runtime"
	"time"
)

var (
	goVersionString = runtime.Version()
	ocrReady        bool // set by Java once the vivo OCR engine has initialised
	ocrInfo         = ""
	sttReady        bool // P16：离线语音识别引擎状态（Java 上报）
	sttInfo         = ""
	tzOffset        = 0
	tzID            = ""
)

// applyTZ pins time.Local to the device's wall clock. The Android Go runtime has no
// tzdata, so time.Now() reports UTC: "逾期" counted 1 item while the page counted 16.
func applyTZ(offSec int, id string) {
	if id == "" {
		id = "device"
	}
	tzOffset, tzID = offSec, id
	time.Local = time.FixedZone(id, offSec)
}

// tzInfo is for the 我的 page: "Asia/Shanghai (UTC+08:00)".
func tzInfo() string {
	if tzID == "" {
		return "UTC"
	}
	h := tzOffset / 3600
	m := (tzOffset - h*3600) / 60
	return sprintf("%s (UTC%+02d:%02d)", tzID, h, absInt(m))
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// setOCR lets Java report the OCR engine state so the UI can show it and the debug tab
// can tell "no text in image" apart from "engine never started".
func setOCR(ready bool, info string) {
	ocrReady, ocrInfo = ready, info
	logf("ocr state: ready=%v %s", ready, info)
}

// setSTT 让 Java 上报离线语音识别引擎状态（P16），与 setOCR 同款。
func setSTT(ready bool, info string) {
	sttReady, sttInfo = ready, info
	logf("stt state: ready=%v %s", ready, info)
}
