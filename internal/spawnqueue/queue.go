package spawnqueue

import (
	"context"
	"math"
	"sync"
	"time"
)

const (
	baseBackoffMs         = 250
	defaultStaleThreshold = 30 * time.Second
)

type SpawnRequest struct {
	SessionID  string
	Title      string
	Timestamp  int64
	RetryCount int
}

type SpawnResult struct {
	Success bool
	PaneID  string
}

type SpawnFn func(context.Context, SpawnRequest) SpawnResult

type Options struct {
	SpawnFn        SpawnFn
	SpawnDelay     time.Duration
	MaxRetries     int
	StaleThreshold time.Duration
	OnQueueUpdate  func(int)
	OnQueueDrained func()
}

type queueItem struct {
	sessionID  string
	title      string
	enqueuedAt time.Time
	waiters    []chan SpawnResult
}

type Queue struct {
	mu             sync.Mutex
	spawnFn        SpawnFn
	spawnDelay     time.Duration
	maxRetries     int
	staleThreshold time.Duration
	onQueueUpdate  func(int)
	onQueueDrained func()

	items            []*queueItem
	pendingBySession map[string]*queueItem
	inFlight         *queueItem
	isProcessing     bool
	isShutdown       bool
}

func New(opts Options) *Queue {
	spawnDelay := opts.SpawnDelay
	if spawnDelay <= 0 {
		spawnDelay = 300 * time.Millisecond
	}
	staleThreshold := opts.StaleThreshold
	if staleThreshold <= 0 {
		staleThreshold = defaultStaleThreshold
	}
	maxRetries := opts.MaxRetries
	if maxRetries < 0 {
		maxRetries = 0
	}

	return &Queue{
		spawnFn:          opts.SpawnFn,
		spawnDelay:       spawnDelay,
		maxRetries:       maxRetries,
		staleThreshold:   staleThreshold,
		onQueueUpdate:    opts.OnQueueUpdate,
		onQueueDrained:   opts.OnQueueDrained,
		pendingBySession: make(map[string]*queueItem),
	}
}

func (q *Queue) Enqueue(ctx context.Context, sessionID, title string) SpawnResult {
	resultCh := make(chan SpawnResult, 1)

	q.mu.Lock()
	if q.isShutdown {
		q.mu.Unlock()
		return SpawnResult{Success: false}
	}

	if existing, ok := q.pendingBySession[sessionID]; ok {
		existing.waiters = append(existing.waiters, resultCh)
		q.mu.Unlock()
		select {
		case res := <-resultCh:
			return res
		case <-ctx.Done():
			return SpawnResult{Success: false}
		}
	}

	item := &queueItem{
		sessionID:  sessionID,
		title:      title,
		enqueuedAt: time.Now(),
		waiters:    []chan SpawnResult{resultCh},
	}
	q.items = append(q.items, item)
	q.pendingBySession[sessionID] = item
	pending := q.pendingCountLocked()
	q.mu.Unlock()

	q.notifyUpdate(pending)
	q.processAsync()

	select {
	case res := <-resultCh:
		return res
	case <-ctx.Done():
		return SpawnResult{Success: false}
	}
}

func (q *Queue) PendingCount() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.pendingCountLocked()
}

func (q *Queue) Shutdown() {
	q.mu.Lock()
	if q.isShutdown {
		q.mu.Unlock()
		return
	}
	q.isShutdown = true

	toResolve := make([]*queueItem, 0, len(q.pendingBySession))
	for _, item := range q.pendingBySession {
		toResolve = append(toResolve, item)
	}

	q.items = nil
	q.pendingBySession = make(map[string]*queueItem)
	q.inFlight = nil
	q.mu.Unlock()

	for _, item := range toResolve {
		q.resolveItem(item, SpawnResult{Success: false})
	}
	q.notifyUpdate(0)
}

func (q *Queue) processAsync() {
	q.mu.Lock()
	if q.isProcessing || q.isShutdown {
		q.mu.Unlock()
		return
	}
	q.isProcessing = true
	q.mu.Unlock()

	go q.processLoop()
}

func (q *Queue) processLoop() {
	defer func() {
		q.mu.Lock()
		q.isProcessing = false
		empty := len(q.items) == 0 && q.inFlight == nil
		q.mu.Unlock()
		if empty && q.onQueueDrained != nil {
			q.onQueueDrained()
		}
	}()

	for {
		q.mu.Lock()
		if q.isShutdown || len(q.items) == 0 {
			pending := q.pendingCountLocked()
			q.mu.Unlock()
			q.notifyUpdate(pending)
			return
		}

		item := q.items[0]
		q.items = q.items[1:]
		q.inFlight = item
		pending := q.pendingCountLocked()
		q.mu.Unlock()

		q.notifyUpdate(pending)
		if time.Since(item.enqueuedAt) > q.staleThreshold {
			q.resolveItem(item, SpawnResult{Success: false})
			q.mu.Lock()
			if q.inFlight == item {
				q.inFlight = nil
			}
			delete(q.pendingBySession, item.sessionID)
			q.mu.Unlock()
			continue
		}

		res := q.processItem(item)
		q.resolveItem(item, res)

		q.mu.Lock()
		if q.inFlight == item {
			q.inFlight = nil
		}
		delete(q.pendingBySession, item.sessionID)
		hasNext := len(q.items) > 0
		isShutdown := q.isShutdown
		q.mu.Unlock()

		if !isShutdown && hasNext {
			time.Sleep(q.spawnDelay)
		}
	}
}

func (q *Queue) processItem(item *queueItem) SpawnResult {
	result := SpawnResult{Success: false}
	for attempt := 0; attempt <= q.maxRetries; attempt++ {
		q.mu.Lock()
		isShutdown := q.isShutdown
		q.mu.Unlock()
		if isShutdown {
			return SpawnResult{Success: false}
		}
		if q.spawnFn == nil {
			return SpawnResult{Success: false}
		}
		result = q.spawnFn(context.Background(), SpawnRequest{
			SessionID:  item.sessionID,
			Title:      item.title,
			Timestamp:  item.enqueuedAt.UnixMilli(),
			RetryCount: attempt,
		})
		if result.Success {
			return result
		}
		if attempt < q.maxRetries {
			backoff := time.Duration(float64(baseBackoffMs)*math.Pow(2, float64(attempt))) * time.Millisecond
			time.Sleep(backoff)
		}
	}
	return result
}

func (q *Queue) resolveItem(item *queueItem, result SpawnResult) {
	q.mu.Lock()
	waiters := item.waiters
	item.waiters = nil
	q.mu.Unlock()
	for _, waiter := range waiters {
		waiter <- result
		close(waiter)
	}
}

func (q *Queue) pendingCountLocked() int {
	count := len(q.items)
	if q.inFlight != nil {
		count++
	}
	return count
}

func (q *Queue) notifyUpdate(pending int) {
	if q.onQueueUpdate != nil {
		q.onQueueUpdate(pending)
	}
}
