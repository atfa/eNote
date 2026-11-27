package dev.xduo.enote;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.util.Log;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;
import java.util.ArrayList;

/**
 * 任意音频（m4a / mp3 / ogg / amr / wav…）→ 16 kHz 单声道 PCM16 WAV。
 *
 * 离线语音引擎只吃这一种格式：SttHelper.readWav 只认 WAV 的 data 块，且整条链路（引擎、
 * 实时录音、时长计算）都按 16000Hz / 单声道 / 16bit 写死。所以从外面分享进来的音频必须先
 * 解码 + 混音 + 重采样，否则识别出来是糊的（甚至 duration 都对不上）。
 *
 * 全程离线：MediaExtractor / MediaCodec 都是系统自带的解码器，不联网、不需要厂商服务。
 * 解码上限 {@link #MAX_SECS} 秒（手机上再长的语音没有笔记价值，而 PCM 全在内存里）。
 */
final class AudioDecode {
    static final String TAG = "enote-audio";
    /** 解码上限：5 分钟。16k/16bit 单声道 ≈ 9.6MB，原始采样率下的中间缓冲 ≈ 26MB。 */
    static final int MAX_SECS = 300;

    private AudioDecode() {}

    /** 目标 WAV 落在 inbox（与实时录音同一目录，/sttaudio 只发这一层里的文件）。 */
    static File toWav16k(android.content.Context ctx, File src) throws Exception {
        Pcm p = decode(src);
        short[] out = resample(p.samples, p.rate, SttHelper.SAMPLE_RATE);
        File dst = new File(OcrHelper.inboxDir(ctx),
                "voice_" + System.currentTimeMillis() + ".wav");
        writeWav(dst, out);
        Log.i(TAG, "decoded " + src.getName() + " " + p.rate + "Hz/" + p.channels + "ch -> "
                + dst.getName() + " " + (out.length / SttHelper.SAMPLE_RATE) + "s");
        return dst;
    }

    // ------------------------------------------------------------ decode

    /** 解码出来的一段 PCM：已经是单声道，采样率还是源采样率。 */
    static final class Pcm {
        short[] samples;
        int rate;
        int channels;
    }

    static Pcm decode(File src) throws Exception {
        MediaExtractor ex = new MediaExtractor();
        ex.setDataSource(src.getAbsolutePath());
        Pcm p = new Pcm();
        int track = -1;
        MediaFormat fmt = null;
        for (int i = 0; i < ex.getTrackCount(); i++) {
            MediaFormat f = ex.getTrackFormat(i);
            String m = f.getString(MediaFormat.KEY_MIME);
            if (m != null && m.startsWith("audio/")) {
                track = i;
                fmt = f;
                break;
            }
        }
        if (track < 0 || fmt == null) {
            ex.release();
            throw new Exception("没有音频轨");
        }
        ex.selectTrack(track);
        p.rate = fmt.containsKey(MediaFormat.KEY_SAMPLE_RATE)
                ? fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE) : SttHelper.SAMPLE_RATE;
        p.channels = fmt.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
                ? fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 1;
        if (p.rate <= 0) p.rate = SttHelper.SAMPLE_RATE;
        if (p.channels <= 0) p.channels = 1;

        MediaCodec dec = null;
        try {
            dec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME));
            dec.configure(fmt, null, null, 0);
            dec.start();

            final ArrayList<short[]> chunks = new ArrayList<short[]>();
            final long maxSamples = (long) p.rate * MAX_SECS;
            long total = 0;
            int enc = AudioFormat.ENCODING_PCM_16BIT;
            int ch = p.channels;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inDone = false, outDone = false;
            while (!outDone) {
                if (!inDone) {
                    int ii = dec.dequeueInputBuffer(10000);
                    if (ii >= 0) {
                        ByteBuffer ib = dec.getInputBuffer(ii);
                        int sz = ex.readSampleData(ib, 0);
                        if (sz < 0) {
                            dec.queueInputBuffer(ii, 0, 0, 0,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inDone = true;
                        } else {
                            dec.queueInputBuffer(ii, 0, sz, ex.getSampleTime(), 0);
                            ex.advance();
                        }
                    }
                }
                int oi = dec.dequeueOutputBuffer(info, 10000);
                if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat of = dec.getOutputFormat();
                    /* 有的解码器输出 float（KEY_PCM_ENCODING = ENCODING_PCM_FLOAT），
                       按 16bit 读会得到噪音。这个键是 API 24 才有的，常量在编译期内联，
                       低版本设备上取不到就走默认的 16bit。 */
                    try {
                        if (of.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                            enc = of.getInteger(MediaFormat.KEY_PCM_ENCODING);
                        }
                        if (of.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                            ch = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                        }
                    } catch (Throwable ignored) {
                    }
                    if (ch <= 0) ch = 1;
                } else if (oi >= 0) {
                    if (info.size > 0) {
                        ByteBuffer ob = dec.getOutputBuffer(oi);
                        if (ob != null) {
                            ob.position(info.offset);
                            ob.limit(info.offset + info.size);
                            short[] mono = enc == AudioFormat.ENCODING_PCM_FLOAT
                                    ? floatToMono(ob, ch) : shortToMono(ob, ch);
                            if (mono.length > 0) {
                                chunks.add(mono);
                                total += mono.length;
                            }
                        }
                    }
                    dec.releaseOutputBuffer(oi, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outDone = true;
                    if (total >= maxSamples) outDone = true; // 到上限：别再往内存里堆了
                }
            }
            int n = (int) Math.min(total, maxSamples);
            p.samples = new short[n];
            int off = 0;
            for (short[] c : chunks) {
                int k = Math.min(c.length, n - off);
                if (k <= 0) break;
                System.arraycopy(c, 0, p.samples, off, k);
                off += k;
            }
            if (off < n) { // 上限截断：尾巴清零（静音）
                p.samples = java.util.Arrays.copyOf(p.samples, off);
            }
            p.channels = 1;
        } finally {
            if (dec != null) {
                try { dec.stop(); } catch (Throwable ignored) { }
                try { dec.release(); } catch (Throwable ignored) { }
            }
            ex.release();
        }
        if (p.samples.length == 0) throw new Exception("解码后没有音频数据");
        return p;
    }

    static short[] shortToMono(ByteBuffer ob, int ch) {
        ShortBuffer sb = ob.order(ByteOrder.nativeOrder()).asShortBuffer();
        int frames = sb.remaining() / ch;
        short[] out = new short[frames];
        for (int i = 0; i < frames; i++) {
            int acc = 0;
            for (int c = 0; c < ch; c++) acc += sb.get();
            out[i] = (short) (acc / ch);
        }
        return out;
    }

    static short[] floatToMono(ByteBuffer ob, int ch) {
        FloatBuffer fb = ob.order(ByteOrder.nativeOrder()).asFloatBuffer();
        int frames = fb.remaining() / ch;
        short[] out = new short[frames];
        for (int i = 0; i < frames; i++) {
            float acc = 0;
            for (int c = 0; c < ch; c++) acc += fb.get();
            float v = acc / ch;
            if (v > 1f) v = 1f;
            if (v < -1f) v = -1f;
            out[i] = (short) Math.round(v * 32767f);
        }
        return out;
    }

    // ---------------------------------------------------------- resample

    /** 线性插值重采样。语音识别对 44.1k→16k 的插值误差不敏感，不必上多相滤波器。 */
    static short[] resample(short[] in, int srcRate, int dstRate) {
        if (in.length == 0 || srcRate == dstRate) return in;
        int n = (int) ((long) in.length * dstRate / srcRate);
        if (n <= 0) return new short[0];
        short[] out = new short[n];
        for (int i = 0; i < n; i++) {
            double pos = (double) i * srcRate / dstRate;
            int i0 = (int) pos;
            if (i0 >= in.length) i0 = in.length - 1;
            int i1 = Math.min(i0 + 1, in.length - 1);
            double fr = pos - i0;
            out[i] = (short) Math.round(in[i0] * (1 - fr) + in[i1] * fr);
        }
        return out;
    }

    // ------------------------------------------------------------- write

    static void writeWav(File dst, short[] pcm) throws Exception {
        byte[] b = new byte[pcm.length * 2];
        for (int i = 0; i < pcm.length; i++) {
            int v = pcm[i];
            b[i * 2] = (byte) (v & 0xFF);
            b[i * 2 + 1] = (byte) ((v >> 8) & 0xFF);
        }
        RandomAccessFile raf = new RandomAccessFile(dst, "rw");
        try {
            raf.setLength(0);
            SttHelper.writeWavHeader(raf, b.length);  // 16k / mono / 16bit，与实时录音同格式
            raf.write(b);
        } finally {
            raf.close();
        }
    }
}
