package httpapi

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestLongLivedSessionTokensAreNotAcceptedFromQueryString(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/tracks/1/stream?session_token=auth-secret&playback_token=playback-secret", nil)
	if token := authSessionToken(request); token != "" {
		t.Fatalf("auth token from query = %q, want empty", token)
	}
	if token := playbackSessionToken(request); token != "" {
		t.Fatalf("playback token from query = %q, want empty", token)
	}

	request.Header.Set("Authorization", "Bearer auth-header")
	request.Header.Set("X-Playback-Session-Token", "playback-header")
	if token := authSessionToken(request); token != "auth-header" {
		t.Fatalf("auth token from header = %q, want auth-header", token)
	}
	if token := playbackSessionToken(request); token != "playback-header" {
		t.Fatalf("playback token from header = %q, want playback-header", token)
	}
}

func TestStreamTicketManagerScopesGrantToPlaybackSession(t *testing.T) {
	now := time.Date(2026, time.July, 17, 12, 0, 0, 0, time.UTC)
	manager := newStreamTicketManager(time.Hour)
	token, expiresAt, err := manager.Grant(42, "playback-hash", now)
	if err != nil {
		t.Fatal(err)
	}
	if expiresAt != now.Add(time.Hour) {
		t.Fatalf("expires at = %s, want %s", expiresAt, now.Add(time.Hour))
	}

	grant, ok := manager.Validate(token, now.Add(time.Minute))
	if !ok {
		t.Fatal("ticket should be valid")
	}
	if grant.UserID != 42 || grant.PlaybackTokenHash != "playback-hash" {
		t.Fatalf("grant = %#v", grant)
	}

	manager.RevokePlayback("playback-hash")
	if _, ok := manager.Validate(token, now.Add(2*time.Minute)); ok {
		t.Fatal("ticket should be revoked with its playback session")
	}
}

func TestStreamTicketManagerRefreshesPlaybackTicketWithoutRotatingURL(t *testing.T) {
	now := time.Date(2026, time.July, 17, 12, 0, 0, 0, time.UTC)
	manager := newStreamTicketManager(time.Minute)
	token, firstExpiresAt, err := manager.Grant(42, "playback-hash", now)
	if err != nil {
		t.Fatal(err)
	}

	refreshedToken, refreshedExpiresAt, err := manager.Grant(42, "playback-hash", now.Add(30*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if refreshedToken != token {
		t.Fatalf("refreshed token = %q, want original token", refreshedToken)
	}
	if !refreshedExpiresAt.After(firstExpiresAt) {
		t.Fatalf("refreshed expiry = %s, want after %s", refreshedExpiresAt, firstExpiresAt)
	}
	if _, ok := manager.Validate(token, firstExpiresAt.Add(time.Second)); !ok {
		t.Fatal("refreshed ticket should remain valid after its original expiry")
	}
}

func TestStreamTicketManagerRejectsExpiredTicket(t *testing.T) {
	now := time.Date(2026, time.July, 17, 12, 0, 0, 0, time.UTC)
	manager := newStreamTicketManager(time.Minute)
	token, _, err := manager.Grant(7, "playback-hash", now)
	if err != nil {
		t.Fatal(err)
	}

	if _, ok := manager.Validate(token, now.Add(time.Minute)); ok {
		t.Fatal("ticket should expire at the configured deadline")
	}
}

func TestPresenceSessionCanOnlyBeRemovedByItsUser(t *testing.T) {
	now := time.Date(2026, time.July, 17, 12, 0, 0, 0, time.UTC)
	presence := newPresenceTracker()
	presence.Touch("session-a", 42, "13800000000", "Alice", now)

	snapshot := presence.RemoveForUser("session-a", 7, now.Add(time.Second))
	if snapshot.OnlineCount != 1 {
		t.Fatalf("online count after foreign removal = %d, want 1", snapshot.OnlineCount)
	}
	snapshot = presence.RemoveForUser("session-a", 42, now.Add(2*time.Second))
	if snapshot.OnlineCount != 0 {
		t.Fatalf("online count after owner removal = %d, want 0", snapshot.OnlineCount)
	}
}
