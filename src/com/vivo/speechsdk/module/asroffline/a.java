package com.vivo.speechsdk.module.asroffline;

/**
 * Reconstructed from JoviIme 3.8.3 (ASRListener.java).
 * The native engine calls back into ASR.nativeCallBack(String, boolean), which
 * forwards to ASR.mASRListener.a(text, isFinal).
 */
public interface a {
    void a(String text, boolean isFinal);
}
