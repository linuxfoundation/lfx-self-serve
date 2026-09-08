<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Runbook: Measuring SSR Pod Cold Start

## Overview

This runbook reproduces the measurements behind the
[SSR Cold-Start Timeline](../architecture/backend/ssr-startup.md). Use it to
re-derive the phase breakdown after a rollout, a chart change, or a Karpenter
NodePool change — the numbers in the architecture doc are point-in-time
samples, not a live figure.

---

## Cross-reference a rollout's Kubernetes events with its boot logs

```bash
# 1. Find the pods from a rollout:
kubectl -n ui get pods -l app.kubernetes.io/name=lfx-self-serve \
  --sort-by=.metadata.creationTimestamp

# 2. Pull the pod-level events (Scheduled/Pulling/Pulled/Created/Started).
#    Use `get events`, not `describe pod` — describe renders event age
#    relative to "now" (e.g. "2m"), which drifts as soon as any time has
#    passed and can't be joined accurately to the absolute log timestamps
#    below. `get events` exposes the actual firstTimestamp/lastTimestamp.
kubectl -n ui get events --field-selector involvedObject.name=<pod-name> \
  -o json | jq -r '.items[] | "\(.lastTimestamp) \(.reason) \(.message)"'

# 3. Pull the two boot log lines (requires the pod's Datadog tags/name):
#    - "server startup: Node Express server started" (has engine_ms/routes_ms/boot_ms)
#    - "[otel] import complete" (has elapsed_ms)
kubectl -n ui logs <pod-name> --timestamps | grep -E 'otel\] import complete|server startup'
```

`--timestamps` is essential — kubelet-side wall-clock per line is what joins
the in-process `elapsed_ms`/`boot_ms` figures to the Kubernetes Event
timeline.

## Query Datadog for the same log lines

`service:lfx-self-serve env:<env> "Node Express server started"` and
`service:lfx-self-serve env:<env> "otel] import complete"` — note the message
text, not the `server_startup` field value, is what's searchable as free
text.

The numeric fields (`engine_ms`, `routes_ms`, `boot_ms`, `elapsed_ms`) are
under `attributes.custom.data.*` / `attributes.custom.*` and are visible via
the Datadog Logs Explorer or `search_datadog_logs` with `extra_fields: ["*"]`;
they do not appear in a default TSV export.

## Separating image pull from process start

Compare a restart on a node that already has the image cached against one
that doesn't — the `Pulled` event message states the pull duration verbatim.
Capture at least 5 samples per case; boot time is noisy under CPU contention.

## Distinguishing a slow boot from event-loop starvation

`kubectl describe pod` renders probe failures as either
`connect: connection refused` (not yet listening — slow boot) or
`context deadline exceeded` (listening but not responding — event-loop
starvation). These imply different fixes; record which one you see.
