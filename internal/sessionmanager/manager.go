package sessionmanager

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/AnganSamadder/opentmux/internal/config"
	"github.com/AnganSamadder/opentmux/internal/logging"
	"github.com/AnganSamadder/opentmux/internal/metrics"
	"github.com/AnganSamadder/opentmux/internal/reaper"
	"github.com/AnganSamadder/opentmux/internal/spawnqueue"
	"github.com/AnganSamadder/opentmux/internal/tmux"
)

const (
	pollIntervalMs        = 2000
	sessionTimeout        = 10 * time.Minute
	sessionMissingGraceMs = pollIntervalMs * 3
)

type SessionEvent struct {
	Type     string
	ID       string
	ParentID string
	Title    string
}

type trackedSession struct {
	SessionID    string
	PaneID       string
	ParentID     string
	Title        string
	CreatedAt    time.Time
	LastSeenAt   time.Time
	MissingSince *time.Time
}

type Manager struct {
	mu          sync.Mutex
	cfg         config.Config
	serverURL   string
	enabled     bool
	sessions    map[string]*trackedSession
	pending     map[string]struct{}
	queue       *spawnqueue.Queue
	ticker      *time.Ticker
	done        chan struct{}
	layoutTimer *time.Timer
	reaper      *reaper.Reaper
	metrics     *metrics.Metrics
}

func New(cfg config.Config, serverURL string, m *metrics.Metrics) *Manager {
	if m == nil {
		m = metrics.New()
	}
	mgr := &Manager{
		cfg:       cfg,
		serverURL: serverURL,
		enabled:   cfg.Enabled && tmux.IsInsideTmux(),
		sessions:  make(map[string]*trackedSession),
		pending:   make(map[string]struct{}),
		done:      make(chan struct{}),
		metrics:   m,
	}
	mgr.queue = spawnqueue.New(spawnqueue.Options{
		SpawnFn: func(ctx context.Context, req spawnqueue.SpawnRequest) spawnqueue.SpawnResult {
			res := tmux.SpawnPane(req.SessionID, req.Title, cfg, serverURL)
			return spawnqueue.SpawnResult{Success: res.Success, PaneID: res.PaneID}
		},
		SpawnDelay: time.Duration(cfg.SpawnDelayMs) * time.Millisecond,
		MaxRetries: cfg.MaxRetryAttempts,
		OnQueueUpdate: func(pending int) {
			mgr.metrics.SetQueueDepth(uint64(pending))
		},
		OnQueueDrained: func() {
			mgr.scheduleLayout()
		},
	})

	mgr.reaper = reaper.New(serverURL, cfg)
	if mgr.enabled {
		mgr.reaper.Start()
	}

	return mgr
}

func (m *Manager) OnSessionCreated(ctx context.Context, event SessionEvent) bool {
	if !m.enabled || event.Type != "session.created" || event.ID == "" || event.ParentID == "" {
		return false
	}

	m.mu.Lock()
	if _, ok := m.sessions[event.ID]; ok {
		m.mu.Unlock()
		return false
	}
	if _, ok := m.pending[event.ID]; ok {
		m.mu.Unlock()
		return false
	}
	m.pending[event.ID] = struct{}{}
	m.metrics.SetPendingSessions(uint64(len(m.pending)))
	m.mu.Unlock()

	title := event.Title
	if title == "" {
		title = "Subagent"
	}

	result := m.queue.Enqueue(ctx, event.ID, title)

	m.mu.Lock()
	delete(m.pending, event.ID)
	m.metrics.SetPendingSessions(uint64(len(m.pending)))
	if result.Success && result.PaneID != "" {
		now := time.Now()
		m.sessions[event.ID] = &trackedSession{
			SessionID:  event.ID,
			PaneID:     result.PaneID,
			ParentID:   event.ParentID,
			Title:      title,
			CreatedAt:  now,
			LastSeenAt: now,
		}
		m.metrics.SetTrackedSessions(uint64(len(m.sessions)))
		if m.ticker == nil {
			m.ticker = time.NewTicker(pollIntervalMs * time.Millisecond)
			go m.pollLoop()
		}
	}
	m.mu.Unlock()

	return result.Success
}

func (m *Manager) pollLoop() {
	for {
		select {
		case <-m.ticker.C:
			m.pollOnce(context.Background())
		case <-m.done:
			return
		}
	}
}

func (m *Manager) pollOnce(ctx context.Context) {
	m.mu.Lock()
	if len(m.sessions) == 0 {
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()

	statuses, ok := m.fetchStatuses(ctx)
	if !ok {
		return
	}

	now := time.Now()
	toClose := make([]string, 0)

	m.mu.Lock()
	for sessionID, tracked := range m.sessions {
		statusType, hasStatus := statuses[sessionID]
		isIdle := statusType == "idle"
		if hasStatus {
			tracked.LastSeenAt = now
			tracked.MissingSince = nil
		} else if tracked.MissingSince == nil {
			t := now
			tracked.MissingSince = &t
		}

		missingTooLong := tracked.MissingSince != nil && now.Sub(*tracked.MissingSince) >= time.Duration(sessionMissingGraceMs)*time.Millisecond
		isTimedOut := now.Sub(tracked.CreatedAt) >= sessionTimeout
		if isIdle || missingTooLong || isTimedOut {
			toClose = append(toClose, sessionID)
		}
	}
	m.mu.Unlock()

	for _, sessionID := range toClose {
		m.CloseSession(sessionID)
	}
}

func (m *Manager) fetchStatuses(ctx context.Context) (map[string]string, bool) {
	statusURL := strings.TrimRight(m.serverURL, "/") + "/session/status"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, statusURL, nil)
	if err != nil {
		return nil, false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, false
	}

	var payload struct {
		Data map[string]struct {
			Type string `json:"type"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, false
	}

	statuses := make(map[string]string, len(payload.Data))
	for id, status := range payload.Data {
		statuses[id] = status.Type
	}
	return statuses, true
}

func (m *Manager) CloseSession(sessionID string) {
	m.mu.Lock()
	tracked, ok := m.sessions[sessionID]
	if !ok {
		m.mu.Unlock()
		return
	}
	delete(m.sessions, sessionID)
	m.metrics.SetTrackedSessions(uint64(len(m.sessions)))
	m.mu.Unlock()

	_ = tmux.ClosePane(tracked.PaneID, m.cfg)

	m.mu.Lock()
	if len(m.sessions) == 0 && m.ticker != nil {
		m.ticker.Stop()
		m.ticker = nil
	}
	m.mu.Unlock()
}

func (m *Manager) scheduleLayout() {
	m.mu.Lock()
	if m.layoutTimer != nil {
		m.layoutTimer.Stop()
	}
	debounce := m.cfg.LayoutDebounceMs
	if debounce <= 0 {
		debounce = 150
	}
	m.layoutTimer = time.AfterFunc(time.Duration(debounce)*time.Millisecond, func() {
		_ = tmux.ApplyLayout(m.cfg)
	})
	m.mu.Unlock()
}

func (m *Manager) Cleanup(reason string) {
	logging.Log("[session-manager] cleanup", map[string]any{"reason": reason})
	select {
	case <-m.done:
	default:
		close(m.done)
	}
	if m.ticker != nil {
		m.ticker.Stop()
	}
	if m.layoutTimer != nil {
		m.layoutTimer.Stop()
	}
	m.queue.Shutdown()
	m.reaper.Stop()

	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()

	for _, sessionID := range ids {
		m.CloseSession(sessionID)
	}
}

func (m *Manager) Snapshot() metrics.Snapshot {
	return m.metrics.Snapshot()
}
