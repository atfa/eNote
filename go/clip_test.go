package main

import (
	"strings"
	"testing"
)

// The de-dupe fingerprint used to be computed from the incoming arguments on both sides of
// the comparison, so "is this the same as the newest item?" was always true and every clip
// after the first one was silently dropped. This test is the regression guard: three
// different copies must end up as three items.
func TestClipAddKeepsDistinctCopies(t *testing.T) {
	dir := t.TempDir()
	s, err := openClipStore(dir)
	if err != nil {
		t.Fatalf("openClipStore: %v", err)
	}
	old := clipStore
	clipStore = s
	defer func() { clipStore = old }()

	for i, txt := range []string{"第一条内容", "第二条内容", "第三条内容"} {
		r := clipAdd("text", txt, "", "", "", "app"+string(rune('a'+i)))
		if !strings.Contains(r, `"ok":true`) || strings.Contains(r, "duplicate") {
			t.Fatalf("copy %d must be stored, got %s", i+1, r)
		}
	}
	if n := clipCount(); n != 3 {
		t.Fatalf("want 3 clips, got %d", n)
	}
}

// An exact repeat is dropped, and a fast double-copy from the same source replaces the
// newest item instead of stacking up.
func TestClipAddDedupRules(t *testing.T) {
	dir := t.TempDir()
	s, err := openClipStore(dir)
	if err != nil {
		t.Fatalf("openClipStore: %v", err)
	}
	old := clipStore
	clipStore = s
	defer func() { clipStore = old }()

	if r := clipAdd("text", "同一句话", "", "", "", "chrome"); !strings.Contains(r, `"ok":true`) {
		t.Fatalf("first copy: %s", r)
	}
	if r := clipAdd("text", "同一句话", "", "", "", "notes"); !strings.Contains(r, "duplicate") {
		t.Fatalf("exact repeat must be a duplicate, got %s", r)
	}
	if r := clipAdd("text", "改过的同一句话", "", "", "", "chrome"); !strings.Contains(r, `"ok":true`) {
		t.Fatalf("same source within 5s: %s", r)
	}
	if n := clipCount(); n != 1 {
		t.Fatalf("the 5s same-source rule must replace, not stack: want 1 clip, got %d", n)
	}
	snap := clipStore.snapshot()
	if len(snap) > 0 && snap[0].Text != "改过的同一句话" {
		t.Fatalf("newest clip should be the replacement, got %q", snap[0].Text)
	}
}
