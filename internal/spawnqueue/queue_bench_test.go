package spawnqueue

import (
	"context"
	"strconv"
	"testing"
)

func BenchmarkQueueBurst100(b *testing.B) {
	for i := 0; i < b.N; i++ {
		q := New(Options{
			SpawnFn: func(context.Context, SpawnRequest) SpawnResult {
				return SpawnResult{Success: true, PaneID: "%1"}
			},
			SpawnDelay: 0,
			MaxRetries: 0,
		})

		for n := 0; n < 100; n++ {
			_ = q.Enqueue(context.Background(), "ses-"+strconv.Itoa(n), "task")
		}
		q.Shutdown()
	}
}
