#pragma once

#ifdef __cplusplus
extern "C" {
#endif

enum enote_llama_phase {
    ENOTE_UNLOADED, ENOTE_LOADING, ENOTE_PREFILL, ENOTE_GENERATING, ENOTE_LOADED
};
int enote_llama_stage(const char * path);
void enote_llama_unload(void);

// The caller frees the returned UTF-8 string. On failure it contains an error message.
char * enote_llama_generate(const char * path, const char * system, const char * user,
                            int max_tokens, double temperature, int timeout_seconds,
                            int * status);

#ifdef __cplusplus
}
#endif
