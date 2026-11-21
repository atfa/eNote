package com.vivo.aiocr.general;

/** Result of runDetectDirect(): text-line boxes + orientation flag. */
public class SaveDetDirect {
    public int directFlag;
    public int errorCode;
    public int[] mDet;
}
