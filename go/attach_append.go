package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

type pickedAttachment struct {
	Path string `json:"path"`
	Name string `json:"name"`
	MIME string `json:"mime"`
}

type appendAttachmentsResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// appendPickedAttachments accepts copies from the native picker. The picker owns
// cleaning up the files if their metadata could not be committed.
func appendPickedAttachments(payload string) appendAttachmentsResult {
	var request struct {
		NoteID string             `json:"noteId"`
		Files  []pickedAttachment `json:"files"`
	}
	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return appendAttachmentsResult{Error: "附件信息无效"}
	}
	if store == nil {
		return appendAttachmentsResult{Error: "笔记存储未就绪"}
	}
	if err := store.appendAttachments(request.NoteID, request.Files); err != nil {
		return appendAttachmentsResult{Error: err.Error()}
	}
	return appendAttachmentsResult{OK: true}
}

func (s *Store) appendAttachments(noteID string, files []pickedAttachment) error {
	if len(files) == 0 {
		return errors.New("没有选中附件")
	}
	inbox := filepath.Join(filepath.Dir(s.path), "inbox")
	return s.updateSaved(noteID, func(n *Note) error {
		paths := make(map[string]struct{}, len(n.Attachments)+len(files))
		for _, attachment := range n.Attachments {
			paths[attachment.Path] = struct{}{}
		}
		at := time.Now()
		for _, file := range files {
			path := filepath.Clean(file.Path)
			if !filepath.IsAbs(path) || filepath.Dir(path) != inbox {
				return errors.New("附件文件保存位置无效")
			}
			if _, exists := paths[path]; exists {
				return errors.New("该文件已在笔记附件中")
			}
			stat, err := os.Lstat(path)
			if err != nil || !stat.Mode().IsRegular() {
				return errors.New("找不到已保存的附件")
			}
			paths[path] = struct{}{}
			a := attachmentFor(n.ID, path, file.Name, file.MIME, "manual-file", at)
			a.Role = attachmentSupplemental
			attachTo(n, a)
		}
		return nil
	})
}
