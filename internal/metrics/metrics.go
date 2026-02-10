package metrics

import "sync/atomic"

type Snapshot struct {
	TrackedSessions uint64 `json:"tracked_sessions"`
	PendingSessions uint64 `json:"pending_sessions"`
	QueueDepth      uint64 `json:"queue_depth"`
}

type Metrics struct {
	trackedSessions atomic.Uint64
	pendingSessions atomic.Uint64
	queueDepth      atomic.Uint64
}

func New() *Metrics {
	return &Metrics{}
}

func (m *Metrics) SetTrackedSessions(v uint64) {
	m.trackedSessions.Store(v)
}

func (m *Metrics) SetPendingSessions(v uint64) {
	m.pendingSessions.Store(v)
}

func (m *Metrics) SetQueueDepth(v uint64) {
	m.queueDepth.Store(v)
}

func (m *Metrics) Snapshot() Snapshot {
	return Snapshot{
		TrackedSessions: m.trackedSessions.Load(),
		PendingSessions: m.pendingSessions.Load(),
		QueueDepth:      m.queueDepth.Load(),
	}
}
