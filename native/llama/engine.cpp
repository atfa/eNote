#include "engine.h"
#include "chat.h"
#include "common.h"
#include "llama.h"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <memory>
#include <mutex>
#include <sys/stat.h>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {
using clock_type = std::chrono::steady_clock;
using model_ptr = std::unique_ptr<llama_model, decltype(&llama_model_free)>;
using context_ptr = std::unique_ptr<llama_context, decltype(&llama_free)>;
using sampler_ptr = std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)>;

std::mutex stage_mutex;
struct stat stage_file = {};
enote_llama_phase phase = ENOTE_UNLOADED;
model_ptr resident_model(nullptr, llama_model_free);
thread_local char last_native_error[1024] = {};

bool same_file(const struct stat & a, const struct stat & b) {
    return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size;
}

void report_stage(enote_llama_phase next) {
    std::lock_guard<std::mutex> lock(stage_mutex);
    phase = next;
}

void capture_native_error(ggml_log_level level, const char * text, void *) {
    if (level == GGML_LOG_LEVEL_ERROR && !last_native_error[0]) {
        std::strncpy(last_native_error, text, sizeof(last_native_error) - 1);
    }
}

bool timed_out(void * data) {
    return clock_type::now() >= *static_cast<clock_type::time_point *>(data);
}

std::string generate(const char * path, const char * system, const char * user,
                     int max_tokens, double temperature, clock_type::time_point & deadline,
                     int & status) {
    static const bool initialized = [] {
        llama_log_set(capture_native_error, nullptr);
        llama_backend_init();
        return true;
    }();
    (void) initialized;
    struct stat file = {};
    if (stat(path, &file) != 0) throw std::runtime_error("无法读取已导入的 GGUF 文件");
    {
        std::lock_guard<std::mutex> lock(stage_mutex);
        if (resident_model && !same_file(stage_file, file)) resident_model.reset();
        stage_file = file;
        phase = resident_model ? ENOTE_PREFILL : ENOTE_LOADING;
    }
    if (!resident_model) {
        auto model_params = llama_model_default_params();
        model_params.n_gpu_layers = 0;
        model_params.progress_callback = [](float, void * data) { return !timed_out(data); };
        model_params.progress_callback_user_data = &deadline;
        resident_model.reset(llama_model_load_from_file(path, model_params));
        if (!resident_model) {
            const char * detail = last_native_error[0] ? last_native_error : "请检查模型格式和手机可用内存";
            throw std::runtime_error(std::string("加载 GGUF 失败：") + detail);
        }
        report_stage(ENOTE_PREFILL);
    }
    auto * model = resident_model.get();

    auto templates = common_chat_templates_init(model, "");
    common_chat_templates_inputs input;
    input.enable_thinking = false;
    common_chat_msg system_message;
    system_message.role = "system";
    system_message.content = system;
    common_chat_msg user_message;
    user_message.role = "user";
    user_message.content = user;
    input.messages = {system_message, user_message};
    auto chat = common_chat_templates_apply(templates.get(), input);
    const auto * vocab = llama_model_get_vocab(model);
    std::vector<llama_token> tokens;
    for (const auto & part : chat.prompt.parts) {
        auto piece = common_tokenize(vocab, part.text, tokens.empty(), !part.is_input);
        tokens.insert(tokens.end(), piece.begin(), piece.end());
    }

    auto params = llama_context_default_params();
    params.n_ctx = std::clamp(llama_model_n_ctx_train(model), 1, 4096);
    if (tokens.empty() || tokens.size() >= params.n_ctx) {
        throw std::runtime_error("内容超过本地模型上下文长度，请缩短后重试");
    }
    params.n_batch = 256;
    params.n_ubatch = 256;
    params.n_threads = std::clamp(std::thread::hardware_concurrency(), 1u, 4u);
    params.n_threads_batch = params.n_threads;
    params.abort_callback = timed_out;
    params.abort_callback_data = &deadline;
    context_ptr ctx(llama_init_from_model(model, params), llama_free);
    if (!ctx) throw std::runtime_error("无法创建推理上下文");

    auto decode = [&](llama_token * batch, int count) {
        if (timed_out(&deadline) || llama_decode(ctx.get(), llama_batch_get_one(batch, count)) != 0) {
            throw std::runtime_error("本地模型解码失败");
        }
    };
    for (size_t offset = 0; offset < tokens.size(); offset += params.n_batch) {
        decode(tokens.data() + offset, std::min<size_t>(params.n_batch, tokens.size() - offset));
    }

    sampler_ptr sampler(llama_sampler_chain_init(llama_sampler_chain_default_params()), llama_sampler_free);
    if (temperature <= 0) {
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_top_k(40));
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_temp(temperature));
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    }
    report_stage(ENOTE_GENERATING);
    std::string result;
    const int limit = std::min<int>(max_tokens, params.n_ctx - tokens.size());
    for (int i = 0; i < limit; ++i) {
        if (timed_out(&deadline)) throw std::runtime_error("本地推理超时");
        auto token = llama_sampler_sample(sampler.get(), ctx.get(), -1);
        if (llama_vocab_is_eog(vocab, token)) {
            status = 0;
            return result;
        }
        result += common_token_to_piece(vocab, token, false);
        if (i + 1 < limit) decode(&token, 1);
    }
    status = 1;
    return result;
}
}  // namespace

int enote_llama_stage(const char * path) {
    struct stat file = {};
    if (stat(path, &file) != 0) return ENOTE_UNLOADED;
    std::lock_guard<std::mutex> lock(stage_mutex);
    return same_file(stage_file, file) ? phase : ENOTE_UNLOADED;
}

void enote_llama_unload() {
    resident_model.reset();
    report_stage(ENOTE_UNLOADED);
}

char * enote_llama_generate(const char * path, const char * system, const char * user,
                            int max_tokens, double temperature, int timeout_seconds,
                            int * status) {
    auto deadline = clock_type::now() + std::chrono::seconds(timeout_seconds);
    last_native_error[0] = '\0';
    std::string result;
    try {
        result = generate(path, system, user, max_tokens, temperature, deadline, *status);
    } catch (const std::exception & error) {
        *status = -1;
        if (!timed_out(&deadline)) {
            result = error.what();
        } else {
            std::lock_guard<std::mutex> lock(stage_mutex);
            const char * step = phase == ENOTE_LOADING ? "加载模型" :
                                phase == ENOTE_PREFILL ? "处理输入" : "生成回复";
            result = std::string(step) + "超时（" + std::to_string(timeout_seconds) + " 秒）";
        }
    } catch (...) {
        *status = -1;
        result = "本地推理失败";
    }
    report_stage(resident_model ? ENOTE_LOADED : ENOTE_UNLOADED);
    return strdup(result.c_str());
}
