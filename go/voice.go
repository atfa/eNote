package main

import (
	"path/filepath"
	"strings"
)

// ---------------------------------------------------------------------------
// 语音识别后处理 (P16)
//
// 离线引擎偶尔会把句尾的语气助词重复一遍（"今天天气好吗" → "今天天气好吗吗"）。
// 我们不能依赖 LLM 每次都改对，所以在入队前先做一道保守的机械纠正：
// 只处理「句尾连续两个相同字 且 该字是语气助词」的情况（吗吗→吗），
// 真叠词（妈妈/谢谢/慢慢/哈哈）不在语气助词集里，一字不动。
// 句子按标点切分逐句判断，避免「你好吗吗。今天…」这种句中重复漏掉。
// 更复杂的同音字/漏字交给 LLM（systemPrompt 规则 6 已扩展语音场景）。
// ---------------------------------------------------------------------------

// tailParticle 是句尾语气助词集合。刻意不含 哈/呵/诶/唉 —— 「哈哈哈」是笑声真叠，
// 会误伤；含「啊」「呀」等，因为引擎确实会重复它们（"好吗啊啊"）。
var tailParticle = map[rune]bool{
	'吗': true, '呢': true, '吧': true, '啊': true, '呀': true, '啦': true,
	'哦': true, '噢': true, '嘛': true, '哇': true, '嘞': true, '呗': true,
	'哟': true, '哩': true,
}

// fixVoiceDup 对整段识别文本做句尾语气助词去重。
func fixVoiceDup(s string) string {
	runes := []rune(s)
	var out []rune
	start := 0
	flush := func(end int) {
		out = append(out, fixTailRunes(runes[start:end])...)
	}
	for i, r := range runes {
		if strings.ContainsRune("。！？；!?;\n", r) {
			flush(i)
			out = append(out, r)
			start = i + 1
		}
	}
	flush(len(runes))
	return string(out)
}

// fixTailRunes 对一句的句尾去一次重：末尾两个字相同且是语气助词 → 删一个。
func fixTailRunes(rs []rune) []rune {
	n := len(rs)
	ws := 0 // 句尾空白数（"吗吗 " 这类），判断时跳过，删除时不影响
	for ws < n && (rs[n-1-ws] == ' ' || rs[n-1-ws] == '\t' || rs[n-1-ws] == '\r') {
		ws++
	}
	eff := n - ws // 去掉尾空白后的有效结尾（不含）
	if eff >= 2 && rs[eff-1] == rs[eff-2] && tailParticle[rs[eff-1]] {
		return append(append([]rune{}, rs[:eff-1]...), rs[eff:]...)
	}
	return rs
}

// fillVoice：语音识别文本 + 原音频附件（P16）。识别出的文字是正文，原始音频挂附件，
// 保留可逆性。多段（一次发多条）合并成一条笔记，每段音频各自挂附件。返回非空 = 这条别存。
func fillVoice(n *Note, r ingestReq) string {
	var parts, segTexts []string
	for _, a := range r.Audios {
		if strings.TrimSpace(a.Text) != "" {
			segTexts = append(segTexts, strings.TrimSpace(a.Text))
		}
		if a.Path != "" {
			attachTo(n, attachmentFor(n.ID, a.Path,
				firstNonEmpty(a.Name, filepath.Base(a.Path)), a.MIME, n.Source, n.CreatedAt))
		}
	}
	/* 老的调用方（单段 /api/voice）把整段文本放在 text 里，新调用方把每段放在 audios[].text。
	   两个都给的调用方（Bridge.enqueueVoice 曾经这样）会让正文每段重复一遍，
	   所以 text 与「各段拼起来」相同时就不算重复内容。 */
	if t := strings.TrimSpace(r.Text); t != "" && t != strings.Join(segTexts, "\n\n") {
		parts = append(parts, t)
	}
	parts = append(parts, segTexts...)
	if r.Path != "" {
		attachTo(n, attachmentFor(n.ID, r.Path,
			firstNonEmpty(r.Name, filepath.Base(r.Path)), r.MIME, n.Source, n.CreatedAt))
	}
	txt := strings.TrimSpace(fixVoiceDup(strings.Join(parts, "\n\n")))
	if txt == "" {
		return "语音里没有识别到文字"
	}
	n.RawText = txt
	n.Content = txt
	n.STMs = r.STMs
	return ""
}

// voiceText 是正文的唯一来源：text（老的单段调用方）或 audios[].text（多段），
// 两者内容相同就只算一份，最后统一做句尾去重。fillVoice 与 reingestVoice 都走这里，
// 免得一处拼两遍、一处只读 text（重新识别时正文直接变空，实测踩过）。
func voiceText(r ingestReq) string {
	var parts, segTexts []string
	for _, a := range r.Audios {
		if t := strings.TrimSpace(a.Text); t != "" {
			segTexts = append(segTexts, t)
		}
	}
	if t := strings.TrimSpace(r.Text); t != "" && t != strings.Join(segTexts, "\n\n") {
		parts = append(parts, t)
	}
	parts = append(parts, segTexts...)
	return strings.TrimSpace(fixVoiceDup(strings.Join(parts, "\n\n")))
}
