package main

import "testing"

// P16：离线语音识别偶发「句尾语气助词重复」（"今天天气好吗" → "今天天气好吗吗"）。
// 入队前先做保守机械去重；真叠词必须原样保留。
func TestFixVoiceDup(t *testing.T) {
	cases := []struct{ in, want string }{
		{"今天天气好吗吗", "今天天气好吗"},          // 吗吗（错误的重复）→ 吗
		{"你今天吃饭了吗吗", "你今天吃饭了吗"},        // 句尾 吗吗 → 吗
		{"好的好的", "好的好的"},               // 叠词不是语气助词，不动
		{"妈妈在做饭", "妈妈在做饭"},             // 妈妈真叠，不动
		{"谢谢谢谢", "谢谢谢谢"},               // 谢谢不动
		{"哈哈哈", "哈哈哈"},                 // 哈哈哈是笑声，不动
		{"好吗好吗", "好吗好吗"},               // 吗 在句中（不是句尾连续同字），不动
		{"好啊好啊", "好啊好啊"},               // 中间停顿叠词，不动
		{"你吃饭了吗吗？明天去吗吗", "你吃饭了吗？明天去吗"}, // 多句各自去重
		{"好吗吗。然后呢呢", "好吗。然后呢"},         // 标点分割
		{"", ""},        // 空安全
		{" 吗吗 ", " 吗 "}, // 句尾空白不影响判断
	}
	for _, c := range cases {
		got := fixVoiceDup(c.in)
		if got != c.want {
			t.Errorf("fixVoiceDup(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// voice 入队：正文是识别文字（经过去重），音频挂附件，走 LLM 队列。
func TestVoiceEnqueue(t *testing.T) {
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

	audio := dir + "/voice.wav"
	res := enqueue(ingestReq{Kind: "voice", Text: "今天天气好吗吗", Path: audio,
		Name: "voice.wav", MIME: "audio/wav", Source: "manual-voice"})
	if res.Error != "" {
		t.Fatalf("enqueue voice: %v", res.Error)
	}
	n := store.get(res.ID)
	if n == nil {
		t.Fatal("note not stored")
	}
	if n.RawText != "今天天气好吗" {
		t.Errorf("RawText = %q, want 今天天气好吗", n.RawText)
	}
	if len(n.Attachments) != 1 || n.Attachments[0].Path != audio {
		t.Errorf("attachments = %+v, want the audio attached", n.Attachments)
	}
	if n.Source != "manual-voice" {
		t.Errorf("source = %q", n.Source)
	}
	if n.Status != stQueued {
		t.Errorf("status = %s, want queued (LLM parse)", n.Status)
	}
}

// 重新识别语音（reingestVoice）：把识别文本替换并重新入队。
func TestReingestVoice(t *testing.T) {
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

	audio := dir + "/voice.wav"
	r0 := enqueue(ingestReq{Kind: "voice", Text: "第一次识别", Path: audio,
		Name: "voice.wav", MIME: "audio/wav", Source: "manual-voice"})
	// 重新识别：文本更新 + 重新入队（保留附件）
	_ = enqueue(ingestReq{ID: r0.ID, Kind: "voice", Text: "更准确的识别结果吗吗"})
	n := store.get(r0.ID)
	if n == nil {
		t.Fatal("note gone")
	}
	if n.RawText != "更准确的识别结果吗" {
		t.Errorf("RawText = %q, want the re-recognised text de-duplicated", n.RawText)
	}
	if len(n.Attachments) != 1 || n.Attachments[0].Path != audio {
		t.Errorf("attachment lost on re-recognise: %+v", n.Attachments)
	}
	if n.Status != stQueued {
		t.Errorf("status = %s, want queued", n.Status)
	}
	if n.Error != "" {
		t.Errorf("error = %q", n.Error)
	}
}

// 多段语音：正文 = 各段拼起来。text 和 audios[].text 同时给时不能重复一遍
// （Bridge.enqueueVoice 曾经两处都填，分享 zh.wav 实测正文变成「…\n\n…」）。
func TestVoiceSegsNoDoubleText(t *testing.T) {
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

	a1, a2 := dir+"/s1.wav", dir+"/s2.wav"
	res := enqueue(ingestReq{Kind: "voice", Source: "share-voice",
		Text: "今天天气怎么样？\n\n明天去吗",
		Audios: []voiceSeg{
			{Text: "今天天气怎么样？", Path: a1, Name: "s1.wav", MIME: "audio/wav"},
			{Text: "明天去吗", Path: a2, Name: "s2.wav", MIME: "audio/wav"},
		}})
	if res.Error != "" {
		t.Fatalf("enqueue: %v", res.Error)
	}
	n := store.get(res.ID)
	if n == nil {
		t.Fatal("note not stored")
	}
	if want := "今天天气怎么样？\n\n明天去吗"; n.RawText != want {
		t.Errorf("RawText = %q, want %q", n.RawText, want)
	}
	if len(n.Attachments) != 2 {
		t.Errorf("attachments = %d, want 2 (每段音频各挂一个)", len(n.Attachments))
	}
}

// 重新识别语音时 Java 只送 audios[].text（text 留空）：正文必须照样更新，
// 不能因为只看 r.Text 而把笔记正文清空。
func TestReingestVoiceFromAudios(t *testing.T) {
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

	audio := dir + "/voice.wav"
	r0 := enqueue(ingestReq{Kind: "voice", Text: "第一次识别", Path: audio,
		Name: "voice.wav", MIME: "audio/wav", Source: "manual-voice"})
	_ = enqueue(ingestReq{ID: r0.ID, Kind: "voice", Source: "share-voice",
		Audios: []voiceSeg{{Text: "今天的天气好吗吗", Path: audio, Name: "voice.wav", MIME: "audio/wav"}}})
	n := store.get(r0.ID)
	if n == nil {
		t.Fatal("note gone")
	}
	if want := "今天的天气好吗"; n.RawText != want {
		t.Errorf("RawText = %q, want %q", n.RawText, want)
	}
	if len(n.Attachments) != 1 {
		t.Errorf("attachments = %d, want 1 (重新识别不该动附件)", len(n.Attachments))
	}
	if n.Status != stQueued {
		t.Errorf("status = %s, want queued", n.Status)
	}
}

// P18.3「保存并解析」合二为一：打字内容与语音段一次提交，合成一条笔记。
// text 是用户打的字（不是各段拼起来），所以两份都要进正文：打字内容在前，各段在后；
// 每段音频各自挂附件。handleVoice 不再把 text 丢掉，这条是那条改动的回归锁。
func TestVoiceMergedTextAndSegs(t *testing.T) {
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

	a1, a2 := dir+"/s1.wav", dir+"/s2.wav"
	res := enqueue(ingestReq{Kind: "voice", Source: "manual-voice",
		Text: "补一句：记得买牛奶",
		Audios: []voiceSeg{
			{Text: "今天天气好吗吗", Path: a1, Name: "s1.wav", MIME: "audio/wav"},
			{Text: "明天去爬山", Path: a2, Name: "s2.wav", MIME: "audio/wav"},
		}})
	if res.Error != "" {
		t.Fatalf("enqueue: %v", res.Error)
	}
	n := store.get(res.ID)
	if n == nil {
		t.Fatal("note not stored")
	}
	want := "补一句：记得买牛奶\n\n今天天气好吗\n\n明天去爬山"
	if n.RawText != want {
		t.Errorf("RawText = %q, want %q", n.RawText, want)
	}
	if len(n.Attachments) != 2 {
		t.Errorf("attachments = %d, want 2 (每段音频各挂一个)", len(n.Attachments))
	}
	if n.Source != "manual-voice" {
		t.Errorf("source = %q", n.Source)
	}
}
