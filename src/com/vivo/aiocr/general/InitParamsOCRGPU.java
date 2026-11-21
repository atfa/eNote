package com.vivo.aiocr.general;

/**
 * Field names, types and order must match vivo's classes.dex: libocr_general.so
 * looks them up with JNI GetFieldID("modelDir","Ljava/lang/String;") and friends.
 * (source: com/vivo/aiocr/general/InitParamsOCRGPU.smali in AIService base.apk)
 */
public class InitParamsOCRGPU {
    public String cachePath;
    public String device;
    public int logFlag;
    public String modelDir;
    public String modelDirectDir;
    public int powerVCAP;
    public String recVersion;
    public int threadNumsVCAP;
}
