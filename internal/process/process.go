package process

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func SafeExec(command string) string {
	cmd := exec.Command("sh", "-lc", command)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func GetListeningPIDs(port int) []int {
	if runtime.GOOS == "windows" {
		return nil
	}
	out := SafeExec(fmt.Sprintf("lsof -nP -iTCP:%d -sTCP:LISTEN -t", port))
	if out == "" {
		return nil
	}
	return parsePIDs(out)
}

func IsProcessAlive(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

func GetProcessCommand(pid int) string {
	return SafeExec(fmt.Sprintf("ps -p %d -o command=", pid))
}

func GetProcessChildren(pid int) []int {
	if runtime.GOOS == "windows" {
		return nil
	}
	out := SafeExec(fmt.Sprintf("pgrep -P %d", pid))
	if out == "" {
		return nil
	}
	return parsePIDs(out)
}

func SafeKill(pid int, signal syscall.Signal) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(signal)
	if err == nil {
		return true
	}
	if strings.Contains(err.Error(), "process already finished") || strings.Contains(err.Error(), "no such process") {
		return true
	}
	return false
}

func WaitForProcessExit(pid int, timeout time.Duration) bool {
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !IsProcessAlive(pid) {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return !IsProcessAlive(pid)
}

func FindProcessIDs(pattern string) []int {
	if runtime.GOOS == "windows" {
		return nil
	}
	out := SafeExec(fmt.Sprintf("pgrep -f %q", pattern))
	if out == "" {
		return nil
	}
	return parsePIDs(out)
}

func parsePIDs(output string) []int {
	parts := strings.Split(strings.TrimSpace(output), "\n")
	pids := make([]int, 0, len(parts))
	for _, part := range parts {
		p, err := strconv.Atoi(strings.TrimSpace(part))
		if err == nil {
			pids = append(pids, p)
		}
	}
	return pids
}
