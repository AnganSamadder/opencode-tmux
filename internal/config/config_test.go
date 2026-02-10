package config

import "testing"

func TestDefaultConfigNormalization(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Normalize()
	if cfg.Port != 4096 {
		t.Fatalf("expected default port 4096, got %d", cfg.Port)
	}
	if cfg.Layout == "" {
		t.Fatal("expected default layout to be set")
	}
}

func TestNormalizeClampsOutOfRangeValues(t *testing.T) {
	cfg := Config{
		Port:               -1,
		Layout:             "",
		MainPaneSize:       100,
		SpawnDelayMs:       10,
		MaxRetryAttempts:   10,
		LayoutDebounceMs:   10,
		MaxAgentsPerColumn: 0,
		MaxPorts:           1000,
	}
	cfg.Normalize()

	if cfg.Port != 4096 || cfg.Layout != "main-vertical" || cfg.MainPaneSize != 60 {
		t.Fatalf("normalize failed for base fields: %+v", cfg)
	}
	if cfg.SpawnDelayMs != 300 || cfg.MaxRetryAttempts != 2 || cfg.LayoutDebounceMs != 150 {
		t.Fatalf("normalize failed for timing/retry fields: %+v", cfg)
	}
	if cfg.MaxAgentsPerColumn != 3 || cfg.MaxPorts != 10 {
		t.Fatalf("normalize failed for caps: %+v", cfg)
	}
}

func TestParseJSON(t *testing.T) {
	cfg, err := ParseJSON(`{"port":5000,"layout":"tiled","max_ports":5}`)
	if err != nil {
		t.Fatalf("expected parse success, got %v", err)
	}
	if cfg.Port != 5000 || cfg.Layout != "tiled" || cfg.MaxPorts != 5 {
		t.Fatalf("unexpected parsed config: %+v", cfg)
	}

	if _, err := ParseJSON("{invalid}"); err == nil {
		t.Fatal("expected parse error for invalid json")
	}
}

func TestMergeOverride(t *testing.T) {
	base := DefaultConfig()
	override := Config{Port: 7777, Layout: "tiled", MaxPorts: 20}
	merged := Merge(base, override)
	if merged.Port != 7777 || merged.Layout != "tiled" || merged.MaxPorts != 20 {
		t.Fatalf("expected override fields to apply, got %+v", merged)
	}
}
