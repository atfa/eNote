package main

import (
	"path/filepath"
	"testing"
)

func drainJobs() []string {
	var ids []string
	for {
		select {
		case id := <-jobs:
			ids = append(ids, id)
		default:
			return ids
		}
	}
}

// 验证手动选图「先入队后 OCR」的占位与 reingest 推进语义：
// 1) defer=true 且 ocr 为空时落库为 stQueued（「排队中」），不误落 stRaw、也不推 jobs 队列；
// 2) OCR 完成后带同一 id 再调 enqueue（走 reingest）才写回文本并推入 jobs；
// 3) 若占位后 OCR 为空或出错，带同一 id reingest 原地落位 stRaw / stError。
func TestEnqueueDeferredImageThenReingest(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatalf("openStore: %v", err)
	}
	oldStore := store
	store = s
	drainJobs()
	t.Cleanup(func() {
		drainJobs()
		store = oldStore
	})

	imgPath := filepath.Join(dir, "pick.png")
	r0 := enqueue(ingestReq{
		Kind:   "image",
		Path:   imgPath,
		Name:   "pick.png",
		Source: "manual-image",
		Defer:  true,
	})
	if r0.Error != "" || r0.ID == "" {
		t.Fatalf("deferred enqueue failed: %+v", r0)
	}
	n := store.get(r0.ID)
	if n == nil || n.Status != stQueued || n.Error != "" {
		t.Fatalf("want queued placeholder without error, got %+v", n)
	}
	if got := drainJobs(); len(got) != 0 {
		t.Fatalf("deferred placeholder must not enter jobs, got %v", got)
	}

	// OCR 完成后带 id reingest：补文本、进 jobs 队列、不重复挂附件
	r1 := enqueue(ingestReq{
		ID:     r0.ID,
		Kind:   "image",
		Path:   imgPath,
		Name:   "pick.png",
		OCR:    "明天九点买牛奶",
		OCRMs:  120,
		Source: "manual-image",
	})
	if r1.ID != r0.ID {
		t.Fatalf("reingest id mismatch: want %s got %s", r0.ID, r1.ID)
	}
	n1 := store.get(r0.ID)
	if n1.Status != stQueued || n1.OCRText != "明天九点买牛奶" || len(n1.Attachments) != 1 {
		t.Fatalf("unexpected note after reingest: %+v", n1)
	}
	if got := drainJobs(); len(got) != 1 || got[0] != r0.ID {
		t.Fatalf("want jobs=[%s], got %v", r0.ID, got)
	}

	// 空 OCR 结束（非 defer）与失败分支：分别原地落成 stRaw 与 stError
	enqueue(ingestReq{ID: r0.ID, Kind: "image", Path: imgPath, Name: "pick.png", OCR: "", Source: "manual-image"})
	if nRaw := store.get(r0.ID); nRaw.Status != stRaw {
		t.Fatalf("want stRaw on empty reingest OCR, got %+v", nRaw)
	}
	enqueue(ingestReq{ID: r0.ID, Kind: "image", OCRError: "OCR failed", Source: "manual-image"})
	if nErr := store.get(r0.ID); nErr.Status != stError || nErr.Error != "OCR failed" || nErr.ImagePath != imgPath {
		t.Fatalf("want stError preserving imagePath, got %+v", nErr)
	}
}
