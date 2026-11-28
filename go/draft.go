package main

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type draftRequest struct {
	ID     string       `json:"id"`
	Text   string       `json:"text"`
	Audios []voiceSeg   `json:"audios"`
	Files  []draftMedia `json:"files"`
}

type draftMedia struct {
	pickedAttachment
	OCR      string `json:"ocr"`
	OCRError string `json:"ocrError"`
}

var draftIDPattern = regexp.MustCompile(`^draft-[0-9a-f]{32}$`)

func handleDraft(w http.ResponseWriter, r *http.Request) {
	var body draftRequest
	if err := readBody(r, &body); err != nil || !draftIDPattern.MatchString(body.ID) {
		jsonOut(w, map[string]any{"ok": false, "error": "草稿信息无效"})
		return
	}
	id, queued, err := store.commitDraft(body)
	if err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if queued {
		jobs <- id
	}
	jsonOut(w, map[string]any{"ok": true, "id": id})
}

func (s *Store) commitDraft(body draftRequest) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, n := range s.Notes {
		if n.ID == body.ID {
			// A retry after a lost response returns the accepted note without queuing it again.
			return n.ID, false, nil
		}
	}

	var parts []string
	text := strings.TrimSpace(body.Text)
	voice := voiceText(ingestReq{Audios: body.Audios})
	if text != "" && text != voice {
		parts = append(parts, text)
	}
	if voice != "" {
		parts = append(parts, voice)
	}
	n := newNote(ingestReq{Source: "manual-draft"})
	n.ID = body.ID
	inbox := filepath.Join(filepath.Dir(s.path), "inbox")
	var firstOCRError string
	for _, media := range body.Files {
		path, err := availableDraftPath(inbox, media.Path, "draft-")
		if err != nil || s.referencesDraftPath(path) {
			return "", false, errors.New("所选附件已使用或找不到，请重新选择")
		}
		attachOriginal(n, path, media.Name, media.MIME)
		if ocr := strings.TrimSpace(media.OCR); ocr != "" {
			parts = append(parts, ocr)
		}
		if firstOCRError == "" {
			firstOCRError = media.OCRError
		}
	}
	for _, audio := range body.Audios {
		if audio.Path == "" {
			continue
		}
		path, err := availableDraftPath(inbox, audio.Path, "voice_")
		if err != nil || s.referencesDraftPath(path) {
			return "", false, errors.New("找不到已录制的语音，请重新录制")
		}
		attachOriginal(n, path, audio.Name, audio.MIME)
	}
	switch {
	case len(body.Files) == 0 && len(body.Audios) == 0:
		n.Source = "manual-text"
	case len(body.Files) == 0 && text == "":
		n.Source = "manual-voice"
	case len(body.Files) == 1 && len(body.Audios) == 0 && text == "":
		media := body.Files[0]
		if strings.HasPrefix(attachmentMIME(n.Attachments[0]), "image/") {
			n.Source = "manual-image"
			n.ImagePath, n.ImageName = n.Attachments[0].Path, n.Attachments[0].Name
			n.OCRText = strings.TrimSpace(media.OCR)
		} else {
			n.Source = "manual-file"
		}
	}
	for i := range n.Attachments {
		n.Attachments[i].Source = n.Source
	}
	n.RawText = strings.Join(parts, "\n\n")
	n.Content = n.RawText
	if n.RawText == "" {
		if len(n.Attachments) == 0 {
			return "", false, errors.New("草稿为空")
		}
		n.Status = stRaw
		n.Title = n.Attachments[0].Name
		n.Error = firstOCRError
		if n.Source == "manual-image" && n.Error == "" {
			n.Error = "图片里没有识别到文字"
		}
	}
	previous := len(s.Notes)
	s.Notes = append(s.Notes, n)
	if err := s.save(); err != nil {
		s.Notes = s.Notes[:previous]
		logf("draft save: %v", err)
		return "", false, errors.New("无法保存草稿，请重试")
	}
	return n.ID, n.Status == stQueued, nil
}

func availableDraftPath(inbox, name, prefix string) (string, error) {
	path := filepath.Clean(name)
	if !filepath.IsAbs(path) || filepath.Dir(path) != inbox || !strings.HasPrefix(filepath.Base(path), prefix) {
		return "", errors.New("附件文件保存位置无效")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("找不到已保存的附件")
	}
	return path, nil
}

// Caller holds the store lock. Protect legacy image references too.
func (s *Store) referencesDraftPath(path string) bool {
	for _, n := range s.Notes {
		if n.ImagePath == path {
			return true
		}
		for _, attachment := range n.Attachments {
			if attachment.Path == path {
				return true
			}
		}
	}
	return false
}

func handleDiscardDraftFile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false})
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	inbox := filepath.Join(filepath.Dir(store.path), "inbox")
	path, err := availableDraftPath(inbox, body.Path, "draft-")
	ok := err == nil && !store.referencesDraftPath(path) && os.Remove(path) == nil
	jsonOut(w, map[string]any{"ok": ok})
}
