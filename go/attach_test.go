package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// attachFile makes a real file in a temp dir, because the attachment list reports sizes and
// the acceptance rule is "the list and the disk agree".
func attachFile(t *testing.T, name string, bytes int) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, make([]byte, bytes), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestAttachmentMigrationFromOneImageField(t *testing.T) {
	dir := t.TempDir()
	img := filepath.Join(dir, "photo.jpg")
	if err := os.WriteFile(img, make([]byte, 4321), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	n := &Note{ID: "n1", Title: "现场照片", Source: "share-image", Status: stDone,
		ImagePath: img, ImageName: "photo.jpg", CreatedAt: time.Now()}
	s.add(n)
	if !migrateAttachments(s.Notes[0]) {
		t.Fatal("migration produced nothing")
	}
	if err := s.save(); err != nil {
		t.Fatal(err)
	}
	// reopen: the record is on disk now, so migration must not duplicate it
	s2, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := s2.Notes[0].Attachments
	if len(got) != 1 {
		t.Fatalf("want 1 attachment, got %d", len(got))
	}
	a := got[0]
	if a.Name != "photo.jpg" || a.MIME != "image/jpeg" || a.Size != 4321 {
		t.Fatalf("bad record: %+v", a)
	}
	if a.NoteID != "n1" {
		t.Fatalf("attachment does not point at its note: %+v", a)
	}
	if s2.Notes[0].ImagePath != img {
		t.Fatal("the double write must keep imagePath for the old read paths")
	}
}

func TestAttachmentListSortFilterAndDiskCount(t *testing.T) {
	big := attachFile(t, "报告.pdf", 9000)
	small := attachFile(t, "notes.txt", 20)
	gone := filepath.Join(t.TempDir(), "missing.png")

	testStore(t,
		note("a", "会议", "正文", "", "share-text", stDone, 60),
		note("b", "现场", "正文", "", "share-image", stDone, 10),
	)
	store.update("a", func(n *Note) {
		attachTo(n, attachmentFor("a", big, "报告.pdf", "", "share-file", n.CreatedAt))
		attachTo(n, attachmentFor("a", gone, "missing.png", "", "share-file", n.CreatedAt))
	})
	store.update("b", func(n *Note) {
		attachTo(n, attachmentFor("b", small, "notes.txt", "", "manual-file", n.CreatedAt))
	})

	res := listAttachments("", "created", "", "", "", 0)
	if res.Total != 3 || res.Files != 2 || res.Missing != 1 {
		t.Fatalf("counts: %+v", res)
	}
	if res.Items[0].NoteID != "b" {
		t.Fatalf("newest first expected, got %s", res.Items[0].NoteID)
	}
	if res.Items[0].Kind != "text" {
		t.Fatalf("kind of notes.txt: %s", res.Items[0].Kind)
	}
	if res.DiskFiles != 2 {
		t.Fatalf("disk count: %d", res.DiskFiles)
	}

	bySize := listAttachments("", "size", "", "", "", 0)
	if bySize.Items[0].Size != 9000 {
		t.Fatal("sort=size must put the biggest file first")
	}
	byName := listAttachments("", "name", "", "", "", 0)
	if byName.Items[0].Name != "missing.png" {
		t.Fatalf("sort=name must be A-Z, got %s", byName.Items[0].Name)
	}
	byNameDesc := listAttachments("", "name", "desc", "", "", 0)
	if byNameDesc.Items[0].Name != "报告.pdf" {
		t.Fatalf("dir=desc must reverse the A-Z order, got %s", byNameDesc.Items[0].Name)
	}
	byCreatedAsc := listAttachments("", "created", "asc", "", "", 0)
	if byCreatedAsc.Items[0].NoteID != "a" {
		t.Fatalf("dir=asc must list the oldest first, got %s", byCreatedAsc.Items[0].NoteID)
	}
	pdf := listAttachments("", "created", "", "application/pdf", "", 0)
	if pdf.Total != 1 || pdf.Items[0].Kind != "pdf" {
		t.Fatalf("mime filter: %+v", pdf)
	}
	imgs := listAttachments("", "created", "", "image", "", 0)
	if imgs.Total != 1 || imgs.Items[0].Name != "missing.png" {
		t.Fatalf("kind filter: %+v", imgs)
	}
	one := listAttachments("", "created", "", "", "b", 0)
	if one.Total != 1 || one.Items[0].NoteTitle != "现场" {
		t.Fatalf("note filter: %+v", one)
	}
	// files/missing must describe the filtered list, not the whole store
	if one.Files != 1 || one.Missing != 0 {
		t.Fatalf("filtered counts: %+v", one)
	}
	miss := listAttachments("missing", "", "", "", "", 0)
	if miss.Total != 1 || miss.Files != 0 || miss.Missing != 1 {
		t.Fatalf("missing must be counted among matches: %+v", miss)
	}
	q := listAttachments("报告", "", "", "", "", 0)
	if q.Total != 1 {
		t.Fatalf("q must match file names: %+v", q)
	}
}

func TestAttachDeleteRemovesFileAndKeepsImageInSync(t *testing.T) {
	img := attachFile(t, "a.jpg", 10)
	doc := attachFile(t, "b.pdf", 20)
	testStore(t, note("a", "带附件", "正文", "", "share-image", stDone, 5))
	store.update("a", func(n *Note) {
		n.ImagePath = img
		n.ImageName = "a.jpg"
		attachTo(n, attachmentFor("a", img, "a.jpg", "", "share-image", n.CreatedAt))
		attachTo(n, attachmentFor("a", doc, "b.pdf", "", "share-file", n.CreatedAt))
	})
	it, ok := findAttachment(store.snapshot()[0].Attachments[1].ID)
	if !ok {
		t.Fatal("attachment not found")
	}
	removeFile(it.Path)
	store.update(it.NoteID, func(n *Note) {
		out := n.Attachments[:0]
		for _, a := range n.Attachments {
			if a.ID != it.ID {
				out = append(out, a)
			}
		}
		n.Attachments = out
	})
	if _, err := os.Stat(doc); !os.IsNotExist(err) {
		t.Fatal("the file is still on disk")
	}
	if _, err := os.Stat(img); err != nil {
		t.Fatal("the image must survive: " + err.Error())
	}
	if n := store.get("a"); len(n.Attachments) != 1 || n.ImagePath != img {
		t.Fatalf("note after delete: %+v", n)
	}
}

func TestRemoveNoteDeletesEveryAttachment(t *testing.T) {
	a := attachFile(t, "a.jpg", 10)
	b := attachFile(t, "b.pdf", 20)
	testStore(t, note("a", "两条附件", "正文", "", "share-image", stDone, 5))
	store.update("a", func(n *Note) {
		n.ImagePath = a
		attachTo(n, attachmentFor("a", a, "a.jpg", "", "share-image", n.CreatedAt))
		attachTo(n, attachmentFor("a", b, "b.pdf", "", "share-file", n.CreatedAt))
	})
	if !store.remove("a") {
		t.Fatal("remove failed")
	}
	for _, p := range []string{a, b} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("%s survived the note", p)
		}
	}
	if res := listAttachments("", "", "", "", "", 0); res.Total != 0 {
		t.Fatalf("the list still shows %d attachments", res.Total)
	}
}

func TestAttachmentMimeFromNameWhenGeneric(t *testing.T) {
	// a file:// share reports application/octet-stream; the extension is the better hint
	for _, c := range []struct{ name, mime, kind string }{
		{"a.pdf", "", "pdf"},
		{"a.txt", "application/octet-stream", "text"},
		{"a.png", "application/octet-stream", "image"},
		{"a.docx", "application/octet-stream", "doc"},
		{"a.bin", "application/octet-stream", "file"},
		{"real.tgz", "application/gzip", "archive"},
	} {
		a := attachmentFor("n", "/tmp/"+c.name, c.name, c.mime, "share-file", time.Now())
		if c.kind != "file" && a.MIME == "application/octet-stream" && c.name != "a.bin" {
			t.Fatalf("%s: mime stayed generic", c.name)
		}
		if got := kindOfMime(a.MIME); got != c.kind {
			t.Fatalf("%s (mime %s): kind=%s want %s", c.name, a.MIME, got, c.kind)
		}
	}
}

func TestSearchFileFilterAndAttachmentNames(t *testing.T) {
	doc := attachFile(t, "合同扫描件.pdf", 30)
	testStore(t,
		note("a", "合同", "正文", "", "share-file", stRaw, 60),
		note("b", "纯文本", "正文", "", "share-text", stDone, 10),
	)
	store.update("a", func(n *Note) {
		attachTo(n, attachmentFor("a", doc, "合同扫描件.pdf", "", "share-file", n.CreatedAt))
	})
	if res := runSearch(searchReq{Tab: "notes", Filters: map[string]string{"file": "yes"}}); len(res.Notes) != 1 || res.Notes[0].ID != "a" {
		t.Fatalf("file=yes: %+v", res.Notes)
	}
	if res := runSearch(searchReq{Tab: "notes", Filters: map[string]string{"file": "no"}}); len(res.Notes) != 1 || res.Notes[0].ID != "b" {
		t.Fatalf("file=no: %+v", res.Notes)
	}
	res := runSearch(searchReq{Tab: "notes", Q: "扫描件"})
	if len(res.Notes) != 1 || !contains(res.Where["a"], "附件名") {
		t.Fatalf("attachment names must be searchable: %+v", res.Where)
	}
}
