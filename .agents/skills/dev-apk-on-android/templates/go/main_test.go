package main

import (
	"strings"
	"testing"
)

func TestFib(t *testing.T) {
	if fib(25) != 75025 {
		t.Fatalf("fib(25)=%d", fib(25))
	}
}

func TestPut(t *testing.T) {
	if put("k") != "k->from-go" {
		t.Fatal("put")
	}
}

func TestInfo(t *testing.T) {
	if !strings.Contains(info(), "go=") {
		t.Fatalf("info: %s", info())
	}
}

// go test runs on the phone too: the test binary is an android/arm64 executable.
func TestBenchmark(t *testing.T) {
	b := benchmark(20)
	if b["fib"].(map[string]any)["value"].(int) != 6765 {
		t.Fatalf("benchmark: %v", b)
	}
}
