package reaper

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/AnganSamadder/opentmux/internal/config"
	"github.com/AnganSamadder/opentmux/internal/logging"
	proc "github.com/AnganSamadder/opentmux/internal/process"
)

type candidate struct {
	count     int
	firstSeen time.Time
}

type Reaper struct {
	serverURL string
	cfg       config.Config
	ticker    *time.Ticker
	stop      chan struct{}
	mu        sync.Mutex
	cands     map[int]candidate
}

func New(serverURL string, cfg config.Config) *Reaper {
	return &Reaper{
		serverURL: serverURL,
		cfg:       cfg,
		stop:      make(chan struct{}),
		cands:     make(map[int]candidate),
	}
}

func (r *Reaper) Start() {
	if !r.cfg.ReaperEnabled || r.cfg.ReaperIntervalMs <= 0 {
		return
	}
	if r.ticker != nil {
		return
	}
	r.ticker = time.NewTicker(time.Duration(r.cfg.ReaperIntervalMs) * time.Millisecond)
	go func() {
		for {
			select {
			case <-r.ticker.C:
				r.ScanOnce(context.Background())
			case <-r.stop:
				return
			}
		}
	}()
}

func (r *Reaper) Stop() {
	if r.ticker != nil {
		r.ticker.Stop()
		r.ticker = nil
	}
	select {
	case <-r.stop:
	default:
		close(r.stop)
	}
}

func (r *Reaper) ScanOnce(ctx context.Context) {
	processes := proc.FindProcessIDs("opencode attach")
	if len(processes) == 0 {
		r.mu.Lock()
		r.cands = make(map[int]candidate)
		r.mu.Unlock()
		return
	}

	active, ok := r.fetchActiveSessions(ctx)
	if !ok {
		logging.Log("[reaper] active session fetch failed", nil)
		return
	}

	now := time.Now()
	present := make(map[int]struct{}, len(processes))

	for _, pid := range processes {
		present[pid] = struct{}{}
		cmd := proc.GetProcessCommand(pid)
		if cmd == "" || !strings.Contains(cmd, r.serverURL) {
			continue
		}
		sid := extractSessionID(cmd)
		if sid == "" || active[sid] {
			r.mu.Lock()
			delete(r.cands, pid)
			r.mu.Unlock()
			continue
		}

		r.mu.Lock()
		cand := r.cands[pid]
		if cand.count == 0 {
			cand = candidate{count: 1, firstSeen: now}
		} else {
			cand.count++
		}
		r.cands[pid] = cand
		shouldKill := cand.count >= r.cfg.ReaperMinZombieChecks && now.Sub(cand.firstSeen) >= time.Duration(r.cfg.ReaperGracePeriodMs)*time.Millisecond
		r.mu.Unlock()

		if shouldKill {
			proc.SafeKill(pid, syscall.SIGTERM)
			if !proc.WaitForProcessExit(pid, 2*time.Second) {
				proc.SafeKill(pid, syscall.SIGKILL)
			}
			r.mu.Lock()
			delete(r.cands, pid)
			r.mu.Unlock()
			logging.Log("[reaper] reaped zombie", map[string]any{"pid": pid, "sessionId": sid})
		}
	}

	r.mu.Lock()
	for pid := range r.cands {
		if _, ok := present[pid]; !ok {
			delete(r.cands, pid)
		}
	}
	r.mu.Unlock()
}

func (r *Reaper) fetchActiveSessions(ctx context.Context) (map[string]bool, bool) {
	url := strings.TrimRight(r.serverURL, "/") + "/session/status"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
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

	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, false
	}
	result := make(map[string]bool)
	if data, ok := payload["data"].(map[string]any); ok {
		for k := range data {
			result[k] = true
		}
		return result, true
	}
	for k := range payload {
		if strings.HasPrefix(k, "ses_") || strings.HasPrefix(k, "session_") {
			result[k] = true
		}
	}
	return result, true
}

func extractSessionID(cmd string) string {
	parts := strings.Fields(cmd)
	for i := 0; i < len(parts); i++ {
		if parts[i] == "--session" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func ReapAll(maxPorts int) {
	if maxPorts <= 0 {
		maxPorts = 10
	}
	start := 4096
	end := 4096 + maxPorts
	for port := start; port <= end; port++ {
		pids := proc.GetListeningPIDs(port)
		for _, pid := range pids {
			cmd := proc.GetProcessCommand(pid)
			if strings.Contains(cmd, "opencode") || strings.Contains(cmd, "node") || strings.Contains(cmd, "bun") {
				proc.SafeKill(pid, syscall.SIGTERM)
				if !proc.WaitForProcessExit(pid, 2*time.Second) {
					proc.SafeKill(pid, syscall.SIGKILL)
				}
				fmt.Printf("Reaped server PID %d on port %d\n", pid, port)
			}
		}
	}
}
