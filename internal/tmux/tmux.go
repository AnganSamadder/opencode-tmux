package tmux

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/AnganSamadder/opentmux/internal/config"
	"github.com/AnganSamadder/opentmux/internal/logging"
	proc "github.com/AnganSamadder/opentmux/internal/process"
)

type SpawnResult struct {
	Success bool
	PaneID  string
}

var (
	tmuxPathOnce sync.Once
	tmuxPath     string
)

func IsInsideTmux() bool {
	return os.Getenv("TMUX") != ""
}

func findTmuxPath() string {
	cmd := exec.Command("sh", "-lc", "which tmux")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	path := strings.TrimSpace(string(out))
	if path == "" {
		return ""
	}
	verify := exec.Command(path, "-V")
	if err := verify.Run(); err != nil {
		return ""
	}
	return path
}

func GetTmuxPath() string {
	tmuxPathOnce.Do(func() {
		tmuxPath = findTmuxPath()
	})
	return tmuxPath
}

func runCommand(args ...string) (string, string, error) {
	if len(args) == 0 {
		return "", "", fmt.Errorf("empty command")
	}
	cmd := exec.Command(args[0], args[1:]...)
	out, err := cmd.Output()
	if err == nil {
		return strings.TrimSpace(string(out)), "", nil
	}
	if ee, ok := err.(*exec.ExitError); ok {
		return strings.TrimSpace(string(out)), strings.TrimSpace(string(ee.Stderr)), err
	}
	return strings.TrimSpace(string(out)), "", err
}

func IsServerRunning(serverURL string) bool {
	healthURL := strings.TrimRight(serverURL, "/") + "/health"
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
	if err != nil {
		return false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

func SpawnPane(sessionID string, title string, cfg config.Config, serverURL string) SpawnResult {
	if !cfg.Enabled || !IsInsideTmux() {
		return SpawnResult{Success: false}
	}
	if !IsServerRunning(serverURL) {
		logging.Log("[tmux] server unavailable", map[string]any{"serverUrl": serverURL})
		return SpawnResult{Success: false}
	}

	tmuxPath := GetTmuxPath()
	if tmuxPath == "" {
		return SpawnResult{Success: false}
	}

	opencodeCmd := fmt.Sprintf("opencode attach %s --session %s", serverURL, sessionID)
	stdout, stderr, err := runCommand(tmuxPath, "split-window", "-h", "-d", "-P", "-F", "#{pane_id}", opencodeCmd)
	if err != nil {
		logging.Log("[tmux] split-window failed", map[string]any{"error": err.Error(), "stderr": stderr})
		return SpawnResult{Success: false}
	}

	paneID := strings.TrimSpace(stdout)
	if paneID == "" {
		return SpawnResult{Success: false}
	}

	_, _, _ = runCommand(tmuxPath, "select-pane", "-t", paneID, "-T", truncateTitle(title))
	_ = ApplyLayout(cfg)
	return SpawnResult{Success: true, PaneID: paneID}
}

func ClosePane(paneID string, cfg config.Config) bool {
	if paneID == "" {
		return false
	}
	tmuxPath := GetTmuxPath()
	if tmuxPath == "" {
		return false
	}

	stdout, _, err := runCommand(tmuxPath, "list-panes", "-t", paneID, "-F", "#{pane_pid}")
	if err == nil {
		if shellPID := parsePID(stdout); shellPID > 0 {
			children := proc.GetProcessChildren(shellPID)
			for _, childPID := range children {
				cmd := proc.GetProcessCommand(childPID)
				if strings.Contains(cmd, "opencode") {
					proc.SafeKill(childPID, syscall.SIGTERM)
					if !proc.WaitForProcessExit(childPID, 2*time.Second) {
						proc.SafeKill(childPID, syscall.SIGKILL)
					}
				}
			}
		}
	}

	_, stderr, killErr := runCommand(tmuxPath, "kill-pane", "-t", paneID)
	if killErr != nil {
		logging.Log("[tmux] kill-pane failed", map[string]any{"paneId": paneID, "error": killErr.Error(), "stderr": stderr})
		return false
	}
	_ = ApplyLayout(cfg)
	return true
}

func ApplyLayout(cfg config.Config) error {
	tmuxPath := GetTmuxPath()
	if tmuxPath == "" {
		return fmt.Errorf("tmux not found")
	}
	layout := cfg.Layout
	if layout == "" {
		layout = "main-vertical"
	}
	_, _, err := runCommand(tmuxPath, "select-layout", layout)
	if err != nil {
		_, _, _ = runCommand(tmuxPath, "select-layout", "main-vertical")
		return err
	}
	if layout == "main-horizontal" || layout == "main-vertical" {
		sizeOption := "main-pane-width"
		if layout == "main-horizontal" {
			sizeOption = "main-pane-height"
		}
		_, _, _ = runCommand(tmuxPath, "set-window-option", sizeOption, fmt.Sprintf("%d%%", cfg.MainPaneSize))
	}
	return nil
}

func truncateTitle(title string) string {
	if len(title) <= 30 {
		return title
	}
	return title[:30]
}

func parsePID(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	var pid int
	_, _ = fmt.Sscanf(raw, "%d", &pid)
	return pid
}
