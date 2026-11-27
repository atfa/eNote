#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD/.cache/enote-llama
source_dir=$root/source
build_dir=$root/build
revision=15fcfc7357f8de73671d39e7d8c594e1beb3052d
mkdir -p "$source_dir"
if [[ ! -d "$source_dir/.git" ]]; then
  git -C "$source_dir" init -q
fi
if ! git -C "$source_dir" cat-file -e "$revision^{commit}" 2>/dev/null; then
  git -C "$source_dir" fetch -q --depth 1 https://github.com/ggml-org/llama.cpp.git "$revision"
fi
if [[ $(git -C "$source_dir" rev-parse HEAD 2>/dev/null || true) != "$revision" ]]; then
  git -C "$source_dir" checkout -q --detach "$revision"
fi
cmake -S native/llama -B "$build_dir" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_SOURCE_DIR="$source_dir"
cmake --build "$build_dir" --target enote_llama --parallel "${LLAMA_JOBS:-2}"
