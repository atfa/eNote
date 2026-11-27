package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAppendPickedAttachmentsToExistingNote(t *testing.T) {
	dir := t.TempDir()
	inbox := filepath.Join(dir, "inbox")
	if err := os.Mkdir(inbox, 0o700); err != nil {
		t.Fatal(err)
	}
	writeFile := func(name string) string {
		t.Helper()
		path := filepath.Join(inbox, name)
		if err := os.WriteFile(path, []byte("file"), 0o600); err != nil {
			t.Fatal(err)
		}
		return path
	}

	s, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	s.add(&Note{
		ID: "note", Source: "manual-voice", Content: "录音正文",
		Attachments: []Attachment{{ID: "original", Role: attachmentOriginal, Path: writeFile("voice.wav")}},
		Todos:       []Todo{{ID: "todo"}},
	})

	pdf := pickedAttachment{Path: writeFile("doc.file"), Name: "说明.pdf"}
	if err := s.appendAttachments("note", []pickedAttachment{pdf, {Path: filepath.Join(inbox, "missing")}}); err == nil {
		t.Fatal("expected a missing file to fail the whole batch")
	}
	if got := len(s.get("note").Attachments); got != 1 {
		t.Fatalf("failed batch changed attachments: got %d", got)
	}
	audio := pickedAttachment{Path: writeFile("other.file"), Name: "另一个录音.wav"}
	if err := s.appendAttachments("note", []pickedAttachment{pdf, audio}); err != nil {
		t.Fatal(err)
	}

	s, err = openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	n := s.get("note")
	if len(n.Attachments) != 3 || n.Source != "manual-voice" || n.Content != "录音正文" ||
		len(n.Todos) != 1 || n.Todos[0].ID != "todo" {
		t.Fatalf("append did not preserve the note: %+v", n)
	}
	if n.Attachments[0].ID != "original" || n.Attachments[0].Role != attachmentOriginal {
		t.Fatalf("original attachment changed: %+v", n.Attachments[0])
	}
	if a := n.Attachments[1]; a.NoteID != n.ID || a.Role != attachmentSupplemental || a.MIME != "application/pdf" {
		t.Fatalf("unexpected supplemental PDF metadata: %+v", a)
	}
	if a := n.Attachments[2]; a.Role != attachmentSupplemental || a.MIME != "audio/wav" {
		t.Fatalf("unexpected supplemental audio metadata: %+v", a)
	}
}
