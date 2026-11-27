cmake_minimum_required(VERSION 3.22)
project(enote_llama LANGUAGES C CXX)

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
add_subdirectory("${LLAMA_SOURCE_DIR}" upstream)

add_library(enote_llama SHARED engine.cpp)
# Termux also exposes the host bionic unwinder, which is absent on older Android releases.
# Resolve those calls inside this library against the compiler toolchain's static unwinder.
target_link_libraries(enote_llama PRIVATE llama-common -Wl,--whole-archive -l:libunwind.a -Wl,--no-whole-archive)
target_compile_features(enote_llama PRIVATE cxx_std_17)
target_link_options(enote_llama PRIVATE -Wl,-z,max-page-size=16384 -Wl,--exclude-libs,libunwind.a)
