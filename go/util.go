package main

import (
	"fmt"
	"strings"
)

func sprintf(format string, a ...any) string { return fmt.Sprintf(format, a...) }

func splitLines(s string) []string { return strings.Split(strings.TrimRight(s, "\n"), "\n") }

func joinLines(l []string) string { return strings.Join(l, "\n") }

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if strings.EqualFold(x, s) {
			return true
		}
	}
	return false
}
