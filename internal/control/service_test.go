package control

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	opentmuxv1 "github.com/AnganSamadder/opentmux/gen/go/opentmux/v1"
)

func TestServiceOnSessionCreatedBeforeInitIsRejected(t *testing.T) {
	svc := NewService(nil)
	resp, err := svc.OnSessionCreated(context.Background(), connect.NewRequest(&opentmuxv1.SessionCreatedRequest{
		Type: "session.created",
		Info: &opentmuxv1.SessionCreatedInfo{Id: "ses_1", ParentId: "ses_p", Title: "t"},
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Msg.Accepted {
		t.Fatal("expected session event rejection before Init")
	}
}

func TestServiceInitStatsShutdownLifecycle(t *testing.T) {
	stopped := make(chan string, 1)
	svc := NewService(func(reason string) {
		stopped <- reason
	})

	initResp, err := svc.Init(context.Background(), connect.NewRequest(&opentmuxv1.InitRequest{
		Directory: "",
		ServerUrl: "http://localhost:4096",
	}))
	if err != nil {
		t.Fatalf("init error: %v", err)
	}
	if initResp.Msg.Message == "" {
		t.Fatal("expected init message")
	}

	statsResp, err := svc.Stats(context.Background(), connect.NewRequest(&opentmuxv1.StatsRequest{}))
	if err != nil {
		t.Fatalf("stats error: %v", err)
	}
	if statsResp.Msg.TrackedSessions != 0 || statsResp.Msg.PendingSessions != 0 {
		t.Fatalf("expected zeroed stats, got %+v", statsResp.Msg)
	}

	shutdownResp, err := svc.Shutdown(context.Background(), connect.NewRequest(&opentmuxv1.ShutdownRequest{Reason: "test"}))
	if err != nil {
		t.Fatalf("shutdown error: %v", err)
	}
	if !shutdownResp.Msg.Ok {
		t.Fatal("expected shutdown ok")
	}

	select {
	case reason := <-stopped:
		if reason != "test" {
			t.Fatalf("unexpected stop reason: %s", reason)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected onStop callback")
	}
}

func TestServiceShutdownCallbackCalledOncePerShutdown(t *testing.T) {
	var calls atomic.Int32
	svc := NewService(func(string) {
		calls.Add(1)
	})

	_, _ = svc.Shutdown(context.Background(), connect.NewRequest(&opentmuxv1.ShutdownRequest{Reason: "1"}))
	_, _ = svc.Shutdown(context.Background(), connect.NewRequest(&opentmuxv1.ShutdownRequest{Reason: "2"}))

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if calls.Load() == 2 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("expected callback on each shutdown request, got %d", got)
	}
}
