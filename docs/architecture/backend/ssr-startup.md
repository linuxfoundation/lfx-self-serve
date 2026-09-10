<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# SSR Cold-Start Timeline (#1378)

Companion to [SSR Server Architecture](./ssr-server.md). That doc describes the
server's structure; this one measures how long it takes to boot and why the
`startupProbe` budget is what it is.

## Background

The `lfx-self-serve` chart's `startupProbe` allows up to 310s for a pod to become
ready (`charts/lfx-self-serve/values.yaml:199-200`), a budget sized against an
assumption of ~4 minute cold starts. This chart's own default is
`maxSurge: "100%"` (`charts/lfx-self-serve/values.yaml:7-13`), but prod and
staging override that in the separate `lfx-v2-argocd` repo
(`values/prod/lfx-self-serve.yaml:102-108`, `values/staging/lfx-self-serve.yaml:100-107`)
to `maxSurge: 1` — [issue #1375](https://github.com/linuxfoundation/lfx-self-serve/issues/1375),
per that override's own comment, specifically to stop a `maxSurge: "100%"` rollout
(3 pods / 1500m CPU at once) from forcing Karpenter to provision new nodes on a
cluster that's CPU-request-bound. The trade: with `maxSurge: 1` and
`replicaCount: 3`, prod and staging now pay the cold-start cost three times in
sequence per rollout, instead of once concurrently across three surged pods.

Before this work, the only boot-related log line was at `debug` level and never
emitted in any environment (`LOG_LEVEL` defaults to `info`), so the ~4 minute
figure was never actually measured against current infrastructure — it
predates the dedicated `self-serve` Karpenter NodePool
([`lfx-v2-argocd#1428`](https://github.com/linuxfoundation/lfx-v2-argocd/pull/1428),
merged 2026-08-29), which changed both the node pool and instance type
(`general-purpose-large`/`t3a.xlarge` → `self-serve`/`m6a.xlarge`).

## What was instrumented

Three additions, merged in [#2042](https://github.com/linuxfoundation/lfx-self-serve/pull/2042):

1. `apps/lfx-one/src/server/server.ts` — the boot-complete log promoted from
   `debug` to `info`, with `engine_ms`, `routes_ms`, and `boot_ms` added
   (all `Math.round(performance.now())`, monotonic from process start).
2. `apps/lfx-one/otel.mjs` — an unconditional `[otel] import complete` log with
   `elapsed_ms`, emitted on both the OTEL-enabled and OTEL-disabled paths.

These numbers, plus Kubernetes Events (`Scheduled`, `Pulling`/`Pulled`,
`Created`/`Started`) and the existing `karpenter_nodepool`/`instance-type`
tags on pod-level events, are enough to reconstruct the full cold-start
timeline without adding a profiler.

## Measured phase breakdown

Real production samples, `lfx-self-serve:1.0.198`, `self-serve` NodePool
(`m6a.xlarge`), 2026-09-07. Four samples: three from a rollout that landed on
nodes that already had the image cached ("warm-node"), one from a rollout ~4
minutes earlier that required an actual image pull on those same nodes
("cold-pull").

| Phase                                                                                    | Warm-node (n=3) | Cold-pull (n=1)                     | Source                                                                               |
| ---------------------------------------------------------------------------------------- | --------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| otel import (`otel.mjs` load + SDK start)                                                | 357–384ms       | 552ms                               | `[otel] import complete` `elapsed_ms`                                                |
| Module-graph eval + Angular engine + Express app construction (`engine_ms − elapsed_ms`) | 2.47–2.70s      | 5.40s                               | `server_startup` `engine_ms` minus otel `elapsed_ms`                                 |
| Router mounting + middleware (`routes_ms − engine_ms`)                                   | 31–49ms         | 33ms                                | `server_startup` fields                                                              |
| Listen startup / socket bind (`boot_ms − routes_ms`)                                     | 12–20ms         | 14ms                                | `server_startup` fields                                                              |
| **In-process boot total (`boot_ms`)**                                                    | **2.89–3.13s**  | **6.00s**                           | `server_startup` `boot_ms`                                                           |
| Container `Started` → node process start (residual)                                      | ~1.9–2.8s       | ~2.8s                               | container `Started` event timestamp vs. (`server_startup` log timestamp − `boot_ms`) |
| Image pull (`Pulling` → `Pulled`)                                                        | 0 (cache hit)   | 31.3–33.1s (n=3 pods, same rollout) | kubelet `Pulled` event message                                                       |
| **Scheduled → app listening, end to end**                                                | **~3.7–5.8s**   | **~42s**                            | `Scheduled`/`Started` events → `server_startup` timestamp                            |

Each row is the independent min/max across its sample set, not a per-sample
sum — rows won't add up column-by-column. The end-to-end row is measured
directly from events, not derived by summing the phase rows above it. The
three in-process marks (`server.ts:106,593,717`) are captured after
construction/mounting work completes, not before it — `engine_ms` includes
`new AngularNodeAppEngine()` and `express()` construction on top of the
module-graph eval that precedes them, `routes_ms` includes all router and
middleware mounting (not Angular engine construction alone), and `boot_ms`
is the `listen()` callback firing, i.e. socket-bind time, not router
mounting.

**Findings:**

- The in-process boot (module-graph eval + engine/app construction + router
  mounting + listen startup + otel import) is **3 seconds on a warm node, 6
  seconds on a node that just pulled a fresh image** — the 2x gap is
  consistent with CPU contention on a newly-scheduled node, not code cost.
  Almost all of it is the first phase — module-graph evaluation plus Angular
  engine and Express app construction — not otel and not router
  mounting/listen startup, which are each under 50ms and are not meaningful
  optimization targets. This instrumentation can't further isolate
  module-graph eval from engine/app construction within that first phase;
  see the caveat above.
- The corepack/yarn/pm2 launch overhead between the container's `Started`
  event and the Node process actually beginning (`performance.timeOrigin`) is
  consistently ~2–3 seconds, in both warm and cold-pull cases.
- Image pull, post-`lfx-v2-argocd#1428`, now averages 35.3s (n=24, see
  [issue #1378 comment](https://github.com/linuxfoundation/lfx-self-serve/issues/1378)
  for the full before/after comparison; it was 71.0s, n=86, pre-`lfx-v2-argocd#1428`).
- **End to end, from `Scheduled` to the app accepting traffic, both observed
  cases were under 45 seconds** — nowhere near the 4-minute figure the probe
  budget assumes.

## What this does _not_ explain

None of the rollouts sampled here triggered an actual new EC2 node launch —
the same handful of `self-serve` NodePool node IDs (e.g. `i-01763393aed569188`,
`i-0f58c3d5014e40daa`, `i-03475dab400402f67`) recur across every rollout
observed from 2026-09-02 through 2026-09-08. Karpenter reused existing nodes
in every sample gathered for this analysis.

A genuine Karpenter scale-up — EC2 instance launch, kubelet bootstrap, CNI
setup, node registration with the API server — happens upstream of anything
measured here and was not captured. That step is the most plausible remaining
source of a multi-minute cold start, and it is the piece that would need a
live-captured sample (watching for a `karpenter.sh` node-provisioning event
followed by a first-ever pod schedule onto that node) to quantify. Until that
sample exists, whether the ~4 minute figure is (a) stale, measured before
`lfx-v2-argocd#1428`, or (b) still accurate for the specific case of a
brand-new node, is an
open question this analysis cannot resolve from existing telemetry alone.

## Reproduction

See the [Measuring SSR Cold Start runbook](../../runbooks/measuring-ssr-cold-start.md)
for the `kubectl`/Datadog procedure used to gather the samples above.

## Environment caveats

- **Don't use PR previews as a proxy.** They diverge from dev/prod in two
  opposing directions: CPU limit is ¼ of prod's (`limits.cpu: 500m` vs. `2000m`)
  while OTEL is entirely disabled (no `OTEL_EXPORTER_OTLP_ENDPOINT`), so
  previews overstate CPU-bound phases and understate otel cost.
- **`dev` is the closest faithful proxy** to prod — it shares
  `values/global/lfx-self-serve.yaml` (the 500m/2000m CPU shape and OTEL
  config) with prod.
- Resource limits live in `values/global/lfx-self-serve.yaml:34-40` (dev,
  staging, and prod — not prod-only) in `lfx-v2-argocd`; PR-preview limits live
  in `values/dev/lfx-self-serve-branch.yaml:33-39` in the same repo.

## Where this leaves #1378

Both acceptance criteria are partially addressed:

- **(a) Documented timeline breakdown** — done, above, with real measured
  numbers and sample counts for every observed phase.
- **(b) Measurable reduction, or a finding that it's irreducible** — the
  measured, reproducible parts of cold start (in-process boot, corepack/pm2
  launch, image pull, warm/cold-pull-on-existing-node end-to-end) are already
  well under the 2-minute target — under 45 seconds in every sample. Code-level
  changes (multi-stage Dockerfile, `pm2` fork mode, `NODE_COMPILE_CACHE`) would
  only shave seconds off a process that's already seconds long; none of them
  clears a bar that isn't the actual bottleneck.

**Recommendation:** the `startupProbe`'s 310s budget only covers the window
from container start to `/livez` responding — kubelet doesn't begin probing
until the container is already running, so a Karpenter node-provisioning
event (which happens before the pod is scheduled and the container starts)
falls entirely outside that window no matter how long it takes. The probe
budget and the node-provisioning question are therefore separate, and a
Karpenter sample cannot answer the first:

- **The probe budget** can be evaluated from what's already measured here:
  in-process boot (~3-6s) plus corepack/pm2 launch (~2-3s) is well under 310s
  even in the cold-pull case, so a healthy pod already advances on its first
  successful check — a rollout's duration is governed by actual boot time,
  not by `failureThreshold`. Tightening the budget therefore would **not**
  shrink the three-sequential-cold-starts-per-rollout window that #1375
  traded for; it would only change how quickly a genuinely stuck pod is
  killed and restarted. If pursued for that reason (a `CrashLoopBackOff`-risk
  change — see the gating in the parent plan, and the ≥20-sample p99 gate
  before acting), the arithmetic comment at `values.yaml:199-200` should be
  updated in the same change.
- **A genuine Karpenter node-provisioning sample** is still worth capturing,
  but to answer a different question: whether the original ~4 minute
  cold-start belief ever had a basis, not whether the probe budget is sized
  correctly. If provisioning turns out to take minutes, that time lives
  entirely in Karpenter/EKS/AWS infrastructure outside this repo — it would
  explain where the original assumption came from, but it doesn't change the
  probe-budget math above, since the probe never runs during that phase.
