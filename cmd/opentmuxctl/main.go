package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"connectrpc.com/connect"
	"github.com/AnganSamadder/opentmux/gen/go/opentmux/v1"
	"github.com/AnganSamadder/opentmux/gen/go/opentmux/v1/opentmuxv1connect"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: opentmuxctl <init|session-created|shutdown|stats> [flags]")
		os.Exit(2)
	}

	socketPath := filepath.Join(os.TempDir(), "opentmuxd.sock")
	client := newClient(socketPath)

	switch os.Args[1] {
	case "init":
		fs := flag.NewFlagSet("init", flag.ExitOnError)
		directory := fs.String("directory", "", "project directory")
		serverURL := fs.String("server-url", "http://localhost:4096", "opencode server url")
		fs.StringVar(&socketPath, "socket", socketPath, "unix socket path")
		_ = fs.Parse(os.Args[2:])
		client = newClient(socketPath)
		_, err := client.Init(context.Background(), connect.NewRequest(&opentmuxv1.InitRequest{
			Directory: *directory,
			ServerUrl: *serverURL,
		}))
		if err != nil {
			exitErr(err)
		}
	case "session-created":
		fs := flag.NewFlagSet("session-created", flag.ExitOnError)
		eventType := fs.String("type", "session.created", "event type")
		id := fs.String("id", "", "session id")
		parentID := fs.String("parent-id", "", "parent session id")
		title := fs.String("title", "Subagent", "session title")
		fs.StringVar(&socketPath, "socket", socketPath, "unix socket path")
		_ = fs.Parse(os.Args[2:])
		client = newClient(socketPath)
		_, err := client.OnSessionCreated(context.Background(), connect.NewRequest(&opentmuxv1.SessionCreatedRequest{
			Type: *eventType,
			Info: &opentmuxv1.SessionCreatedInfo{Id: *id, ParentId: *parentID, Title: *title},
		}))
		if err != nil {
			exitErr(err)
		}
	case "shutdown":
		fs := flag.NewFlagSet("shutdown", flag.ExitOnError)
		reason := fs.String("reason", "manual", "shutdown reason")
		fs.StringVar(&socketPath, "socket", socketPath, "unix socket path")
		_ = fs.Parse(os.Args[2:])
		client = newClient(socketPath)
		_, err := client.Shutdown(context.Background(), connect.NewRequest(&opentmuxv1.ShutdownRequest{Reason: *reason}))
		if err != nil {
			exitErr(err)
		}
	case "stats":
		fs := flag.NewFlagSet("stats", flag.ExitOnError)
		fs.StringVar(&socketPath, "socket", socketPath, "unix socket path")
		_ = fs.Parse(os.Args[2:])
		client = newClient(socketPath)
		resp, err := client.Stats(context.Background(), connect.NewRequest(&opentmuxv1.StatsRequest{}))
		if err != nil {
			exitErr(err)
		}
		fmt.Printf("tracked=%d pending=%d queue=%d\n", resp.Msg.TrackedSessions, resp.Msg.PendingSessions, resp.Msg.QueueDepth)
	default:
		fmt.Fprintln(os.Stderr, "unknown command")
		os.Exit(2)
	}
}

func newClient(socketPath string) opentmuxv1connect.OpentmuxControlClient {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: 2 * time.Second}
			return d.DialContext(ctx, "unix", socketPath)
		},
	}
	httpClient := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	return opentmuxv1connect.NewOpentmuxControlClient(httpClient, "http://opentmuxd", connect.WithGRPC())
}

func exitErr(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
