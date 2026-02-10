package main

import (
	"context"
	"flag"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/AnganSamadder/opentmux/gen/go/opentmux/v1/opentmuxv1connect"
	"github.com/AnganSamadder/opentmux/internal/control"
	"github.com/AnganSamadder/opentmux/internal/logging"
)

func main() {
	socketPath := flag.String("socket", filepath.Join(os.TempDir(), "opentmuxd.sock"), "unix socket path")
	flag.Parse()

	_ = os.Remove(*socketPath)
	listener, err := net.Listen("unix", *socketPath)
	if err != nil {
		panic(err)
	}
	defer func() {
		_ = listener.Close()
		_ = os.Remove(*socketPath)
	}()

	_ = os.Chmod(*socketPath, 0o600)

	server := &http.Server{
		ReadTimeout:       10 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      20 * time.Second,
	}
	service := control.NewService(func(reason string) {
		logging.Log("[opentmuxd] shutdown requested", map[string]any{"reason": reason})
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	})
	path, handler := opentmuxv1connect.NewOpentmuxControlHandler(service)
	mux := http.NewServeMux()
	mux.Handle(path, handler)
	server.Handler = mux

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP, syscall.SIGQUIT)
		sig := <-sigCh
		logging.Log("[opentmuxd] shutdown signal", map[string]any{"signal": sig.String()})
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	logging.Log("[opentmuxd] listening", map[string]any{"socket": *socketPath})
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		panic(err)
	}
}
