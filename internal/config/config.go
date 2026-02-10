package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type Config struct {
	Enabled                     bool   `json:"enabled"`
	Port                        int    `json:"port"`
	Layout                      string `json:"layout"`
	MainPaneSize                int    `json:"main_pane_size"`
	AutoClose                   bool   `json:"auto_close"`
	SpawnDelayMs                int    `json:"spawn_delay_ms"`
	MaxRetryAttempts            int    `json:"max_retry_attempts"`
	LayoutDebounceMs            int    `json:"layout_debounce_ms"`
	MaxAgentsPerColumn          int    `json:"max_agents_per_column"`
	ReaperEnabled               bool   `json:"reaper_enabled"`
	ReaperIntervalMs            int    `json:"reaper_interval_ms"`
	ReaperMinZombieChecks       int    `json:"reaper_min_zombie_checks"`
	ReaperGracePeriodMs         int    `json:"reaper_grace_period_ms"`
	ReaperAutoSelfDestruct      bool   `json:"reaper_auto_self_destruct"`
	ReaperSelfDestructTimeoutMs int    `json:"reaper_self_destruct_timeout_ms"`
	RotatePort                  bool   `json:"rotate_port"`
	MaxPorts                    int    `json:"max_ports"`
}

func DefaultConfig() Config {
	return Config{
		Enabled:                     true,
		Port:                        4096,
		Layout:                      "main-vertical",
		MainPaneSize:                60,
		AutoClose:                   true,
		SpawnDelayMs:                300,
		MaxRetryAttempts:            2,
		LayoutDebounceMs:            150,
		MaxAgentsPerColumn:          3,
		ReaperEnabled:               true,
		ReaperIntervalMs:            30000,
		ReaperMinZombieChecks:       3,
		ReaperGracePeriodMs:         5000,
		ReaperAutoSelfDestruct:      true,
		ReaperSelfDestructTimeoutMs: 60 * 60 * 1000,
		RotatePort:                  false,
		MaxPorts:                    10,
	}
}

func (c *Config) Normalize() {
	if c.Port <= 0 {
		c.Port = 4096
	}
	if c.Layout == "" {
		c.Layout = "main-vertical"
	}
	if c.MainPaneSize < 20 || c.MainPaneSize > 80 {
		c.MainPaneSize = 60
	}
	if c.SpawnDelayMs < 50 || c.SpawnDelayMs > 2000 {
		c.SpawnDelayMs = 300
	}
	if c.MaxRetryAttempts < 0 || c.MaxRetryAttempts > 5 {
		c.MaxRetryAttempts = 2
	}
	if c.LayoutDebounceMs < 50 || c.LayoutDebounceMs > 1000 {
		c.LayoutDebounceMs = 150
	}
	if c.MaxAgentsPerColumn < 1 || c.MaxAgentsPerColumn > 10 {
		c.MaxAgentsPerColumn = 3
	}
	if c.MaxPorts < 1 || c.MaxPorts > 100 {
		c.MaxPorts = 10
	}
}

func Merge(base Config, override Config) Config {
	result := base
	b, _ := json.Marshal(override)
	_ = json.Unmarshal(b, &result)
	result.Normalize()
	return result
}

func parseConfigFile(path string) (Config, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	cfg := DefaultConfig()
	if err := json.Unmarshal(content, &cfg); err != nil {
		return Config{}, err
	}
	cfg.Normalize()
	return cfg, nil
}

func LoadConfig(directory string) Config {
	cfg := DefaultConfig()
	paths := make([]string, 0, 3)

	if directory != "" {
		paths = append(paths,
			filepath.Join(directory, "opentmux.json"),
			filepath.Join(directory, "opencode-agent-tmux.json"),
		)
	}

	home := os.Getenv("HOME")
	if home != "" {
		paths = append(paths, filepath.Join(home, ".config", "opencode", "opentmux.json"))
	}

	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			parsed, err := parseConfigFile(p)
			if err == nil {
				return parsed
			}
		}
	}

	cfg.Normalize()
	return cfg
}

func ParseJSON(raw string) (Config, error) {
	if raw == "" {
		cfg := DefaultConfig()
		cfg.Normalize()
		return cfg, nil
	}
	cfg := DefaultConfig()
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return Config{}, err
	}
	cfg.Normalize()
	return cfg, nil
}

func Validate(cfg Config) error {
	if cfg.Layout == "" {
		return errors.New("layout is required")
	}
	return nil
}
