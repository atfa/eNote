package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCommitDraftRetriedWithMixedInputs(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	oldStore := store
	store = s
	drainJobs()
	t.Cleanup(func() {
		drainJobs()
		store = oldStore
	})
	inbox := filepath.Join(dir, "inbox")
	if err := os.Mkdir(inbox, 0700); err != nil {
		t.Fatal(err)
	}
	writeFixture := func(name string) string {
		path := filepath.Join(inbox, name)
		if err := os.WriteFile(path, []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	image := writeFixture("draft-image.file")
	file := writeFixture("draft-pdf.file")
	audio := writeFixture("voice_audio.wav")
	id := "draft-0123456789abcdef0123456789abcdef"
	body := draftRequest{
		ID: id, Text: "typed",
		Audios: []voiceSeg{{Text: "transcript", Path: audio, Name: "recording.wav"}},
		Files: []draftMedia{
			{pickedAttachment: pickedAttachment{Path: image, Name: "photo.png", MIME: "image/png"}, OCR: "recognized"},
			{pickedAttachment: pickedAttachment{Path: file, Name: "document.pdf", MIME: "application/pdf"}},
		},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		rec := httptest.NewRecorder()
		handleDraft(rec, httptest.NewRequest("POST", "/api/draft", bytes.NewReader(payload)))
		var result struct {
			OK bool
			ID string
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil || !result.OK || result.ID != id {
			t.Fatalf("submit result: %s (%v)", rec.Body.String(), err)
		}
	}
	if got := drainJobs(); len(got) != 1 || got[0] != id {
		t.Fatalf("want one queued parse; got %v", got)
	}
	reloaded, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	notes := reloaded.snapshot()
	if len(notes) != 1 || notes[0].RawText != "typed\n\ntranscript\n\nrecognized" || len(notes[0].Attachments) != 3 {
		t.Fatalf("mixed draft was not committed as one complete note: %+v", notes)
	}

	for _, candidate := range []struct {
		path     string
		wantGone bool
	}{{image, false}, {writeFixture("draft-removable.file"), true}} {
		payload, err := json.Marshal(map[string]string{"path": candidate.path})
		if err != nil {
			t.Fatal(err)
		}
		rec := httptest.NewRecorder()
		handleDiscardDraftFile(rec, httptest.NewRequest("POST", "/api/draft/discard", bytes.NewReader(payload)))
		if _, err := os.Stat(candidate.path); os.IsNotExist(err) != candidate.wantGone {
			t.Fatalf("unexpected cleanup of %q (want removed: %t)", candidate.path, candidate.wantGone)
		}
	}
}
