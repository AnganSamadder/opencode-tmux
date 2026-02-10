package logging

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	logMu   sync.Mutex
	logFile = filepath.Join(os.TempDir(), "opencode-agent-tmux.log")
)

func SetLogFile(path string) {
	if path == "" {
		return
	}
	logMu.Lock()
	defer logMu.Unlock()
	logFile = path
}

func Log(message string, data any) {
	entry := map[string]any{
		"ts":      time.Now().Format(time.RFC3339Nano),
		"message": message,
	}
	if data != nil {
		entry["data"] = data
	}
	payload, err := json.Marshal(entry)
	if err != nil {
		payload = []byte(fmt.Sprintf(`{"ts":"%s","message":"%s"}`, time.Now().Format(time.RFC3339Nano), message))
	}

	logMu.Lock()
	defer logMu.Unlock()
	f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(payload, '\n'))
}
