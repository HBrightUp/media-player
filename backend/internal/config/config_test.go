package config

import (
	"testing"
	"time"
)

func TestParseDurationValueAcceptsSecondsAndDurations(t *testing.T) {
	tests := map[string]time.Duration{
		"0":     0,
		"15":    15 * time.Second,
		"30s":   30 * time.Second,
		"2m":    2 * time.Minute,
		"1h30m": 90 * time.Minute,
	}

	for value, want := range tests {
		got, err := parseDurationValue(value)
		if err != nil {
			t.Fatalf("parseDurationValue(%q) returned error: %v", value, err)
		}
		if got != want {
			t.Fatalf("parseDurationValue(%q) = %s, want %s", value, got, want)
		}
	}
}

func TestParseDurationValueRejectsNegativeValues(t *testing.T) {
	for _, value := range []string{"-1", "-5s"} {
		if _, err := parseDurationValue(value); err == nil {
			t.Fatalf("parseDurationValue(%q) returned nil error, want error", value)
		}
	}
}
