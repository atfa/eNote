package com.vivo.aiocr.general;

/** Result of runDetRecDireDel()/runDetectRecogn()/runRecogn() - native allocates and fills it. */
public class SaveWordsResults {
    public int directFlag;
    public int errorCode;
    public int[] mDet;
    public String mRec;
    public float mRot;
    public WordResult[] mWords;
}
