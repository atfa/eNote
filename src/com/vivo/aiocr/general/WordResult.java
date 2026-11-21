package com.vivo.aiocr.general;

/** One recognised word: wDet = box, wRec = text. Field names are JNI-looked-up by name. */
public class WordResult {
    public int[] wDet;
    public String wRec;
}
