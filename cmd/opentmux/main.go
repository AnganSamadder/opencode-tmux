package main

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/AnganSamadder/opentmux/internal/config"
	"github.com/AnganSamadder/opentmux/internal/process"
	"github.com/AnganSamadder/opentmux/internal/reaper"
)

var nonTUICommands = map[string]struct{}{
	"auth": {}, "config": {}, "plugins": {}, "update": {}, "upgrade": {}, "completion": {}, "stats": {},
	"run": {}, "exec": {}, "doctor": {}, "debug": {}, "clean": {}, "uninstall": {}, "agent": {}, "session": {},
	"export": {}, "import": {}, "github": {}, "pr": {}, "serve": {}, "web": {}, "acp": {}, "mcp": {}, "models": {},
	"--version": {}, "-v": {}, "--help": {}, "-h": {},
}

func main() {
	cfg := config.LoadConfig("")
	args := os.Args[1:]
	if len(args) > 0 && (args[0] == "--reap" || args[0] == "-reap") {
		reaper.ReapAll(cfg.MaxPorts)
		return
	}

	isInteractive := len(args) == 0
	_, isCLI := nonTUICommands[firstArg(args)]

	opencodeBin := findOpencodeBin()
	if opencodeBin == "" {
		fmt.Fprintln(os.Stderr, "Error: Could not find \"opencode\" binary in PATH.")
		os.Exit(1)
	}

	if isInteractive || isCLI {
		runPassthrough(opencodeBin, args)
		return
	}

	port := findAvailablePort(cfg)
	if port == 0 {
		if cfg.RotatePort {
			port = rotateOldestPort(cfg)
		}
	}
	if port == 0 {
		fmt.Fprintf(os.Stderr, "Error: No available ports found in range %d-%d.\n", cfg.Port, cfg.Port+cfg.MaxPorts)
		os.Exit(1)
	}

	env := append([]string{}, os.Environ()...)
	env = append(env, "OPENCODE_PORT="+strconv.Itoa(port))
	childArgs := append([]string{"--port", strconv.Itoa(port)}, args...)

	inTmux := os.Getenv("TMUX") != ""
	tmuxAvailable := hasTmux()

	if inTmux || !tmuxAvailable {
		cmd := exec.Command(opencodeBin, childArgs...)
		cmd.Env = env
		cmd.Stdin = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		runOrExit(cmd)
		return
	}

	shellCommand := fmt.Sprintf("%s %s || { echo 'Exit code: $?'; echo 'Press Enter to close...'; read; }", quoteArg(opencodeBin), joinQuoted(childArgs))
	cmd := exec.Command("tmux", "new-session", shellCommand)
	cmd.Env = env
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	runOrExit(cmd)
}

func firstArg(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return args[0]
}

func runPassthrough(opencodeBin string, args []string) {
	passthrough := append([]string{}, args...)
	hasPrintLogs := false
	hasLogLevel := false
	for _, arg := range args {
		if arg == "--print-logs" {
			hasPrintLogs = true
		}
		if strings.HasPrefix(arg, "--log-level") {
			hasLogLevel = true
		}
	}
	if !hasPrintLogs && !hasLogLevel {
		passthrough = append(passthrough, "--log-level", "ERROR")
	}
	cmd := exec.Command(opencodeBin, passthrough...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	runOrExit(cmd)
}

func runOrExit(cmd *exec.Cmd) {
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			if status, ok := ee.Sys().(syscall.WaitStatus); ok {
				os.Exit(status.ExitStatus())
			}
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func quoteArg(arg string) string {
	if strings.ContainsAny(arg, " '\"\t\n") {
		return "'" + strings.ReplaceAll(arg, "'", "'\\''") + "'"
	}
	return arg
}

func joinQuoted(args []string) string {
	out := make([]string, 0, len(args))
	for _, arg := range args {
		out = append(out, quoteArg(arg))
	}
	return strings.Join(out, " ")
}

func hasTmux() bool {
	_, err := exec.LookPath("tmux")
	return err == nil
}

func findOpencodeBin() string {
	bins := strings.Split(process.SafeExec("which -a opencode"), "\n")
	for _, bin := range bins {
		b := strings.TrimSpace(bin)
		if b == "" {
			continue
		}
		if strings.Contains(b, "opentmux") {
			continue
		}
		if filepath.Base(b) == "opencode" || filepath.Base(b) == "opencode.exe" {
			return b
		}
	}
	if runtime.GOOS == "windows" {
		return ""
	}
	for _, p := range []string{"/usr/local/bin/opencode", "/usr/bin/opencode"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func findAvailablePort(cfg config.Config) int {
	start := cfg.Port
	if start <= 0 {
		start = 4096
	}
	end := start + cfg.MaxPorts
	for port := start; port <= end; port++ {
		if checkPort(port) {
			return port
		}
	}
	return 0
}

func rotateOldestPort(cfg config.Config) int {
	start := cfg.Port
	if start <= 0 {
		start = 4096
	}
	end := start + cfg.MaxPorts
	oldestPID := 0
	oldestStart := time.Now().UnixMilli()
	targetPort := 0

	for port := start; port <= end; port++ {
		for _, pid := range process.GetListeningPIDs(port) {
			cmd := process.GetProcessCommand(pid)
			if !(strings.Contains(cmd, "opencode") || strings.Contains(cmd, "node") || strings.Contains(cmd, "bun")) {
				continue
			}
			startTime := process.SafeExec(fmt.Sprintf("ps -p %d -o lstart=", pid))
			if startTime == "" {
				continue
			}
			parsed, err := time.Parse("Mon Jan _2 15:04:05 2006", startTime)
			if err != nil {
				continue
			}
			if parsed.UnixMilli() < oldestStart {
				oldestStart = parsed.UnixMilli()
				oldestPID = pid
				targetPort = port
			}
		}
	}

	if oldestPID == 0 {
		return 0
	}
	process.SafeKill(oldestPID, syscall.SIGTERM)
	_ = process.WaitForProcessExit(oldestPID, 2*time.Second)
	if process.IsProcessAlive(oldestPID) {
		process.SafeKill(oldestPID, syscall.SIGKILL)
		_ = process.WaitForProcessExit(oldestPID, time.Second)
	}
	if checkPort(targetPort) {
		return targetPort
	}
	return 0
}

func checkPort(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}
