package spawnqueue

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestQueueProcessesSequentially(t *testing.T) {
	releaseFirst := make(chan struct{})
	started := make(chan string, 2)

	q := New(Options{
		SpawnFn: func(_ context.Context, req SpawnRequest) SpawnResult {
			started <- req.SessionID
			if req.SessionID == "s1" {
				<-releaseFirst
			}
			return SpawnResult{Success: true, PaneID: "%" + req.SessionID}
		},
		SpawnDelay: 1 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	result1 := make(chan SpawnResult, 1)
	result2 := make(chan SpawnResult, 1)
	go func() { result1 <- q.Enqueue(ctx, "s1", "Task 1") }()

	if got := <-started; got != "s1" {
		t.Fatalf("expected first started session s1, got %s", got)
	}
	go func() { result2 <- q.Enqueue(ctx, "s2", "Task 2") }()

	select {
	case got := <-started:
		t.Fatalf("expected s2 to wait, but started early: %s", got)
	case <-time.After(80 * time.Millisecond):
	}

	close(releaseFirst)
	if got := <-started; got != "s2" {
		t.Fatalf("expected second started session s2, got %s", got)
	}

	if !(<-result1).Success {
		t.Fatal("expected first enqueue to succeed")
	}
	if !(<-result2).Success {
		t.Fatal("expected second enqueue to succeed")
	}
	if got := q.PendingCount(); got != 0 {
		t.Fatalf("expected pending=0, got %d", got)
	}
}

func TestQueueCoalescesDuplicateDuringInFlight(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	started := make(chan struct{}, 1)

	q := New(Options{
		SpawnFn: func(_ context.Context, req SpawnRequest) SpawnResult {
			calls.Add(1)
			started <- struct{}{}
			if req.SessionID == "s1" {
				<-release
			}
			return SpawnResult{Success: true, PaneID: "%1"}
		},
		SpawnDelay: 1 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	r1 := make(chan SpawnResult, 1)
	r2 := make(chan SpawnResult, 1)
	go func() { r1 <- q.Enqueue(ctx, "s1", "Task") }()
	<-started
	go func() { r2 <- q.Enqueue(ctx, "s1", "Task duplicate") }()

	time.Sleep(40 * time.Millisecond)
	if got := calls.Load(); got != 1 {
		t.Fatalf("expected one spawn call for duplicate in-flight enqueue, got %d", got)
	}

	close(release)
	if !(<-r1).Success {
		t.Fatal("expected first result success")
	}
	if !(<-r2).Success {
		t.Fatal("expected duplicate result success")
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("expected one spawn call total, got %d", got)
	}
}

func TestQueueRetriesAndPropagatesRetryCount(t *testing.T) {
	counts := make([]int, 0, 3)

	q := New(Options{
		SpawnFn: func(_ context.Context, req SpawnRequest) SpawnResult {
			counts = append(counts, req.RetryCount)
			if len(counts) < 3 {
				return SpawnResult{Success: false}
			}
			return SpawnResult{Success: true, PaneID: "%ok"}
		},
		SpawnDelay: 1 * time.Millisecond,
		MaxRetries: 2,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	res := q.Enqueue(ctx, "retry", "Retry")
	if !res.Success {
		t.Fatal("expected success after retries")
	}
	if len(counts) != 3 {
		t.Fatalf("expected 3 attempts, got %d", len(counts))
	}
	for i, v := range counts {
		if v != i {
			t.Fatalf("expected retryCount[%d]=%d, got %d", i, i, v)
		}
	}
}

func TestQueueShutdownResolvesPendingAndRejectsFutureEnqueue(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	q := New(Options{
		SpawnFn: func(_ context.Context, req SpawnRequest) SpawnResult {
			if req.SessionID == "s1" {
				started <- struct{}{}
				<-release
			}
			return SpawnResult{Success: true, PaneID: "%" + req.SessionID}
		},
		SpawnDelay: 1 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	r1 := make(chan SpawnResult, 1)
	rDup := make(chan SpawnResult, 1)
	r2 := make(chan SpawnResult, 1)
	go func() { r1 <- q.Enqueue(ctx, "s1", "Task 1") }()
	<-started
	go func() { rDup <- q.Enqueue(ctx, "s1", "Task 1 dup") }()
	go func() { r2 <- q.Enqueue(ctx, "s2", "Task 2") }()

	time.Sleep(20 * time.Millisecond)
	q.Shutdown()
	close(release)

	for _, ch := range []chan SpawnResult{r1, rDup, r2} {
		select {
		case res := <-ch:
			if res.Success {
				t.Fatal("expected shutdown to resolve pending requests as failed")
			}
		case <-time.After(1 * time.Second):
			t.Fatal("timed out waiting for shutdown-resolved result")
		}
	}

	if res := q.Enqueue(ctx, "late", "Late"); res.Success {
		t.Fatal("expected enqueue after shutdown to fail")
	}
}

func TestQueueSkipsStaleItems(t *testing.T) {
	block := make(chan struct{})
	var calls atomic.Int32

	q := New(Options{
		SpawnFn: func(_ context.Context, req SpawnRequest) SpawnResult {
			calls.Add(1)
			if req.SessionID == "s1" {
				<-block
			}
			return SpawnResult{Success: true, PaneID: "%" + req.SessionID}
		},
		SpawnDelay:     1 * time.Millisecond,
		StaleThreshold: 20 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	r1 := make(chan SpawnResult, 1)
	r2 := make(chan SpawnResult, 1)
	go func() { r1 <- q.Enqueue(ctx, "s1", "one") }()
	time.Sleep(10 * time.Millisecond)
	go func() { r2 <- q.Enqueue(ctx, "s2", "two") }()
	time.Sleep(70 * time.Millisecond)
	close(block)

	if !(<-r1).Success {
		t.Fatal("expected first request to succeed")
	}
	if (<-r2).Success {
		t.Fatal("expected stale second request to fail")
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("expected stale item to skip spawn call, got %d calls", got)
	}
}
