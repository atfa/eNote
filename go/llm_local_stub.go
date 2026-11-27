//go:build !android || !arm64 || !enote_llama

package main

import "errors"

const localEngineAvailable = false

func unloadLocalModel() {}

func localStage(string) string { return "unloaded" }

func inferLocal(string, string, string, int, float64, int) (string, string, error) {
	return "", "", errors.New("此版本未包含 llama.cpp")
}
