package main

import (
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestLegacyAttachmentProvenance(t *testing.T) {
	n := &Note{ID: "note", Source: "manual-voice", Attachments: []Attachment{
		{ID: "original", Name: "recording.wav", Source: "manual-voice"},
		{ID: "later", Name: "recording-too.wav", Source: "manual-voice", Role: attachmentSupplemental},
		{ID: "pdf", Name: "file.pdf", Source: "manual-file"},
	}}
	if !migrateNoteMetadata(n) || migrateNoteMetadata(n) {
		t.Fatal("migration should change the note once")
	}
	for i, want := range []string{attachmentOriginal, attachmentSupplemental, attachmentSupplemental} {
		if a := n.Attachments[i]; a.Role != want || a.NoteID != n.ID {
			t.Fatalf("attachment %d: %+v", i, a)
		}
	}
}

func TestFileNoteDescriptionAndOriginalAttachment(t *testing.T) {
	n := &Note{ID: "pdf", Source: "share-file"}
	if err := fillFile(n, ingestReq{Path: "document.pdf"}); err != "" {
		t.Fatal(err)
	}
	testStore(t, n)
	w := httptest.NewRecorder()
	apiMux().ServeHTTP(w, httptest.NewRequest("POST", "/api/note/description",
		strings.NewReader(`{"id":"pdf","description":"  明天发给王敏  "}`)))
	saved, err := openStore(filepath.Dir(store.path))
	if err != nil {
		t.Fatal(err)
	}
	got := saved.get("pdf")
	if got.Description != "明天发给王敏" || got.Content != "" || got.RawText != "" || got.Error != "" {
		t.Fatalf("unexpected saved note: %+v, response: %s", got, w.Body.String())
	}
	if len(got.Attachments) != 1 || got.Attachments[0].Role != attachmentOriginal {
		t.Fatalf("unexpected attachments: %+v", got.Attachments)
	}
	if hits, ok := matchNote(got, "明天发给王敏", nil); !ok || len(hits) != 1 || hits[0] != "说明" {
		t.Fatalf("description search: %v %v", hits, ok)
	}
}

func TestRemovingOriginalImageDoesNotPromoteSupplement(t *testing.T) {
	original := attachFile(t, "original.png", 10)
	later := attachFile(t, "later.png", 10)
	n := &Note{ID: "image", ImagePath: original, Description: "保留说明", Todos: []Todo{{ID: "todo"}}}
	attachOriginal(n, original, "original.png", "image/png")
	a := attachmentFor(n.ID, later, "later.png", "image/png", "manual-file", n.CreatedAt)
	a.Role = attachmentSupplemental
	attachTo(n, a)
	testStore(t, n)
	w := httptest.NewRecorder()
	body := `{"id":"` + n.Attachments[0].ID + `"}`
	handleAttachDelete(w, httptest.NewRequest("POST", "/api/attach/delete", strings.NewReader(body)))
	got := store.get(n.ID)
	if got.ImagePath != "" || len(got.Attachments) != 1 || got.Attachments[0].ID != a.ID ||
		got.Description != "保留说明" || len(got.Todos) != 1 {
		t.Fatalf("unexpected note after removal: %+v, response: %s", got, w.Body.String())
	}
}
