package control

import (
	"context"
	"sync"

	"connectrpc.com/connect"
	"github.com/AnganSamadder/opentmux/gen/go/opentmux/v1"
	"github.com/AnganSamadder/opentmux/internal/config"
	"github.com/AnganSamadder/opentmux/internal/logging"
	"github.com/AnganSamadder/opentmux/internal/metrics"
	"github.com/AnganSamadder/opentmux/internal/sessionmanager"
)

type Service struct {
	mu      sync.Mutex
	manager *sessionmanager.Manager
	metrics *metrics.Metrics
	onStop  func(string)
}

func NewService(onStop func(string)) *Service {
	return &Service{metrics: metrics.New(), onStop: onStop}
}

func (s *Service) Init(ctx context.Context, req *connect.Request[opentmuxv1.InitRequest]) (*connect.Response[opentmuxv1.InitResponse], error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg := config.LoadConfig(req.Msg.Directory)
	if req.Msg.Config != nil {
		cfg = config.Merge(cfg, fromProtoConfig(req.Msg.Config))
	}

	s.manager = sessionmanager.New(cfg, req.Msg.ServerUrl, s.metrics)
	logging.Log("[control] initialized", map[string]any{"directory": req.Msg.Directory, "serverUrl": req.Msg.ServerUrl})

	return connect.NewResponse(&opentmuxv1.InitResponse{
		Enabled: cfg.Enabled,
		Message: "initialized",
	}), nil
}

func (s *Service) OnSessionCreated(ctx context.Context, req *connect.Request[opentmuxv1.SessionCreatedRequest]) (*connect.Response[opentmuxv1.SessionCreatedResponse], error) {
	s.mu.Lock()
	manager := s.manager
	s.mu.Unlock()

	if manager == nil {
		return connect.NewResponse(&opentmuxv1.SessionCreatedResponse{Accepted: false}), nil
	}

	info := req.Msg.GetInfo()
	accepted := manager.OnSessionCreated(ctx, sessionmanager.SessionEvent{
		Type:     req.Msg.GetType(),
		ID:       info.GetId(),
		ParentID: info.GetParentId(),
		Title:    info.GetTitle(),
	})

	return connect.NewResponse(&opentmuxv1.SessionCreatedResponse{Accepted: accepted}), nil
}

func (s *Service) Shutdown(_ context.Context, req *connect.Request[opentmuxv1.ShutdownRequest]) (*connect.Response[opentmuxv1.ShutdownResponse], error) {
	s.mu.Lock()
	manager := s.manager
	s.manager = nil
	onStop := s.onStop
	s.mu.Unlock()

	if manager != nil {
		manager.Cleanup(req.Msg.GetReason())
	}
	if onStop != nil {
		go onStop(req.Msg.GetReason())
	}

	return connect.NewResponse(&opentmuxv1.ShutdownResponse{Ok: true}), nil
}

func (s *Service) Stats(_ context.Context, _ *connect.Request[opentmuxv1.StatsRequest]) (*connect.Response[opentmuxv1.StatsResponse], error) {
	snap := s.metrics.Snapshot()
	return connect.NewResponse(&opentmuxv1.StatsResponse{
		TrackedSessions: snap.TrackedSessions,
		PendingSessions: snap.PendingSessions,
		QueueDepth:      snap.QueueDepth,
	}), nil
}

func fromProtoConfig(in *opentmuxv1.Config) config.Config {
	if in == nil {
		return config.DefaultConfig()
	}
	return config.Config{
		Enabled:                     in.GetEnabled(),
		Port:                        int(in.GetPort()),
		Layout:                      in.GetLayout(),
		MainPaneSize:                int(in.GetMainPaneSize()),
		AutoClose:                   in.GetAutoClose(),
		SpawnDelayMs:                int(in.GetSpawnDelayMs()),
		MaxRetryAttempts:            int(in.GetMaxRetryAttempts()),
		LayoutDebounceMs:            int(in.GetLayoutDebounceMs()),
		MaxAgentsPerColumn:          int(in.GetMaxAgentsPerColumn()),
		ReaperEnabled:               in.GetReaperEnabled(),
		ReaperIntervalMs:            int(in.GetReaperIntervalMs()),
		ReaperMinZombieChecks:       int(in.GetReaperMinZombieChecks()),
		ReaperGracePeriodMs:         int(in.GetReaperGracePeriodMs()),
		ReaperAutoSelfDestruct:      in.GetReaperAutoSelfDestruct(),
		ReaperSelfDestructTimeoutMs: int(in.GetReaperSelfDestructTimeoutMs()),
		RotatePort:                  in.GetRotatePort(),
		MaxPorts:                    int(in.GetMaxPorts()),
	}
}
