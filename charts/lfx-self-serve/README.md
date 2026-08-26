# LFX One UI Helm Chart

This Helm chart deploys the LFX One UI application, which is an Angular SSR application with Express backend for LFX One.

> **Agents:** Self Serve is an Angular/Express SSR app, not a Go service, so
> the chart pattern differs from the V2 Go services. The V2 Go cross-service
> chart conventions (HTTPRoute, Heimdall RuleSet, NATS KV, ExternalSecret
> wrapper-vs-native split) are documented in
> `lfx-v2-helm/docs/service-chart-patterns.md`; only the
> ExternalSecrets section below maps to the same pattern. Deployed image
> tags, chart pins, and environment values live in `lfx-v2-argocd` (note
> that current deployment artifacts may still be named `lfx-v2-ui`).

## Configuration

### Required Configuration

The following secret values must be configured before deployment:

```yaml
environment:
  # Required: Base URL for the PCC application (used for Auth0 callbacks and redirects)
  PCC_BASE_URL:
    value: 'https://pcc.your-domain.com'

  # Required: Auth0 configuration for user authentication
  PCC_AUTH0_CLIENT_ID:
    value: 'your-auth0-client-id'
  PCC_AUTH0_CLIENT_SECRET:
    value: 'your-auth0-client-secret'

  # Required: Supabase configuration for database access
  SUPABASE_URL:
    value: 'https://your-project.supabase.co'
  POSTGRES_API_KEY:
    value: 'your-supabase-api-key'

  # Required: LFX Auth configuration for service-to-service authentication
  M2M_AUTH_CLIENT_ID:
    value: 'your-lfx-auth-client-id'
  M2M_AUTH_CLIENT_SECRET:
    value: 'your-lfx-auth-client-secret'

  # Required: LFX V2 service endpoint for API calls
  LFX_V2_SERVICE:
    value: 'https://api.your-domain.com'

  # Required: NATS messaging service URL for real-time communication
  NATS_URL:
    value: 'nats://nats-server:4222'

  # Required: AI service configuration for AI features
  AI_PROXY_URL:
    value: 'https://api.openai.com/v1/chat/completions'
  AI_API_KEY:
    value: 'your-openai-api-key'

  # Required: Snowflake Analytics configuration
  SNOWFLAKE_ACCOUNT:
    value: 'your-org-account'
  SNOWFLAKE_USER:
    value: 'your-username'
  SNOWFLAKE_ROLE:
    value: 'your-read-role'
  SNOWFLAKE_DATABASE:
    value: 'your-database'
  SNOWFLAKE_WAREHOUSE:
    value: 'your-warehouse'
  SNOWFLAKE_API_KEY:
    value: 'your-private-key'

  # Required: Auth0 session secret
  PCC_AUTH0_SECRET:
    value: 'sufficiently-long-random-string'
```

#### Using Kubernetes Secrets

Environment variables can also be set from Kubernetes secrets for better security:

```yaml
environment:
  POSTGRES_API_KEY:
    valueFrom:
      secretKeyRef:
        name: pcc-env-secrets
        key: postgres_api_key

  PCC_AUTH0_CLIENT_SECRET:
    valueFrom:
      secretKeyRef:
        name: pcc-auth-secrets
        key: client_secret

  AI_API_KEY:
    valueFrom:
      secretKeyRef:
        name: pcc-ai-secrets
        key: api_key
```

### Global Parameters

| Parameter                 | Description                         | Default |
| ------------------------- | ----------------------------------- | ------- |
| `global.imageRegistry`    | Global Docker image registry        | `""`    |
| `global.imagePullSecrets` | Global Docker registry secret names | `[]`    |

### Application Parameters

| Parameter                        | Description                                                                                                    | Default                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `replicaCount`                   | Number of replicas                                                                                             | `3`                                                                           |
| `strategy`                       | Kubernetes rolling update strategy. Default spins up a full new replica set before terminating any old pods.   | `{type: RollingUpdate, rollingUpdate: {maxSurge: "100%", maxUnavailable: 0}}` |
| `terminationGracePeriodSeconds`  | Seconds Kubernetes waits before SIGKILL after SIGTERM. Must exceed `preStop.sleep` + PM2 `kill_timeout` (70s). | `75`                                                                          |
| `lifecycle.preStop.exec.command` | Command run inside the container before SIGTERM. Allows kube-proxy/Traefik to deregister the endpoint.         | `["/bin/sh", "-c", "sleep 10"]`                                               |
| `image.registry`                 | Image registry                                                                                                 | `""`                                                                          |
| `image.repository`               | Image repository                                                                                               | `ghcr.io/linuxfoundation/lfx-self-serve`                                      |
| `image.tag`                      | Image tag                                                                                                      | `"latest"`                                                                    |
| `image.pullPolicy`               | Image pull policy                                                                                              | `IfNotPresent`                                                                |
| `imagePullSecrets`               | Image pull secrets                                                                                             | `[]`                                                                          |
| `nodeSelector`                   | Node labels required for scheduling                                                                            | `{}`                                                                          |
| `tolerations`                    | Taints the pod tolerates. Pair with `nodeSelector` to target a tainted node pool.                              | `[]`                                                                          |
| `affinity`                       | Node/pod affinity rules. Prefer `topologySpreadConstraints` for simple spreading.                              | `{}`                                                                          |
| `priorityClassName`              | PriorityClass for preemption ordering. A nonexistent class blocks scheduling.                                  | `""`                                                                          |
| `topologySpreadConstraints`      | Spread replicas across failure domains                                                                         | `[]`                                                                          |

`tolerations` only lets a pod land on a tainted node pool; it does not require it. Set `nodeSelector` too if the pod must land there.

### Environment Variables

#### Application Configuration

| Parameter              | Description                                  | Required | Default      |
| ---------------------- | -------------------------------------------- | -------- | ------------ |
| `environment.NODE_ENV` | Node.js environment (development/production) | No       | `production` |
| `environment.PORT`     | Application HTTP port                        | No       | `4000`       |
| `environment.ENV`      | Environment identifier for configuration     | No       | `production` |

#### Cache and System Directories

| Parameter                    | Description                       | Required | Default                              |
| ---------------------------- | --------------------------------- | -------- | ------------------------------------ |
| `environment.COREPACK_HOME`  | Corepack cache directory          | No       | `/home/appuser/.cache/node/corepack` |
| `environment.XDG_CACHE_HOME` | XDG cache directory for user data | No       | `/home/appuser/.cache`               |
| `environment.TMPDIR`         | Temporary files directory         | No       | `/tmp`                               |

#### PCC Application Configuration

| Parameter                  | Description                                  | Required | Default                     |
| -------------------------- | -------------------------------------------- | -------- | --------------------------- |
| `environment.PCC_BASE_URL` | Base URL for PCC app (callbacks & redirects) | **Yes**  | `https://pcc.k8s.orb.local` |

#### Auth0 Configuration (User Authentication)

| Parameter                               | Description                              | Required | Default                                            |
| --------------------------------------- | ---------------------------------------- | -------- | -------------------------------------------------- |
| `environment.PCC_AUTH0_ISSUER_BASE_URL` | Auth0 issuer base URL                    | No       | `https://linuxfoundation-dev.auth0.com/`           |
| `environment.PCC_AUTH0_AUDIENCE`        | Auth0 API audience identifier            | No       | `https://api-gw.dev.platform.linuxfoundation.org/` |
| `environment.PCC_AUTH0_CLIENT_ID`       | Auth0 client ID (secret)                 | **Yes**  | -                                                  |
| `environment.PCC_AUTH0_CLIENT_SECRET`   | Auth0 client secret (secret)             | **Yes**  | -                                                  |
| `environment.PCC_AUTH0_SECRET`          | Auth0 session secret (sufficiently long) | **Yes**  | -                                                  |

#### LFX Auth Configuration (Service-to-Service)

| Parameter                              | Description                                   | Required | Default                                            |
| -------------------------------------- | --------------------------------------------- | -------- | -------------------------------------------------- |
| `environment.M2M_AUTH_ISSUER_BASE_URL` | LFX Auth issuer base URL                      | No       | `https://linuxfoundation-dev.auth0.com/`           |
| `environment.M2M_AUTH_AUDIENCE`        | LFX Auth API audience identifier              | No       | `https://api-gw.dev.platform.linuxfoundation.org/` |
| `environment.M2M_AUTH_CLIENT_ID`       | LFX Auth client ID for M2M authentication     | **Yes**  | -                                                  |
| `environment.M2M_AUTH_CLIENT_SECRET`   | LFX Auth client secret for M2M authentication | **Yes**  | -                                                  |

#### Database Configuration

| Parameter                      | Description                                              | Required | Default |
| ------------------------------ | -------------------------------------------------------- | -------- | ------- |
| `environment.SUPABASE_URL`     | Supabase project URL (for user profile email management) | **Yes**  | -       |
| `environment.POSTGRES_API_KEY` | Supabase Postgres API key (anon/service role)            | **Yes**  | -       |

#### External Services

| Parameter                       | Description                            | Required | Default                                                          |
| ------------------------------- | -------------------------------------- | -------- | ---------------------------------------------------------------- |
| `environment.LFX_V2_SERVICE`    | LFX V2 API service endpoint            | **Yes**  | -                                                                |
| `environment.QUERY_SERVICE_URL` | Query service URL for resource queries | No       | `http://query-service.default.svc.cluster.local/query/resources` |
| `environment.NATS_URL`          | NATS messaging server URL              | **Yes**  | -                                                                |

#### Campaign Service Cutover

Campaign endpoints are being moved off this application's vendor-direct integrations and onto
lfx-v2-campaign-service one at a time (LFXV2-3070). Each move is gated so it can be reversed by
changing a value here rather than by shipping a revert.

| Parameter                                                | Description                                                                                                                         | Required | Default |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| `environment.LFX_CUTOVER_CAMPAIGN_SERVICE_JOBS`          | Serves campaign job status from campaign-service; see the accepted values below                                                     | No       | off     |
| `environment.LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS`        | Persists the generated brief in campaign-service instead of only in the browser tab                                                 | No       | off     |
| `environment.LFX_CUTOVER_CAMPAIGN_SERVICE_CREATE`        | Creates campaigns through campaign-service instead of the per-platform Express services                                             | No       | off     |
| `environment.LFX_CUTOVER_CAMPAIGN_SERVICE_DEMAND_GEN`    | Allows Demand Gen Google campaigns. Requires a campaign-service that understands `googleAdsConfig.channel` (LFXV2-3257) — see below | No       | off     |
| `environment.LFX_CUTOVER_CAMPAIGN_SERVICE_STATUS_TOGGLE` | Serves campaign pause/resume from campaign-service, which is what makes Google Ads and LinkedIn pausable — see below                | No       | off     |

Every cutover flag in the table above is ON for `true`, `1`, `yes`, or `on` — trimmed and matched
case-insensitively, so `"True"` and `" on "` also enable it. Every other value is OFF, including
unset, empty, `0`, `false`, and any misspelling. Do not read "only `true` works" into that: an
operator setting `yes` and expecting it to be ignored would route production traffic at
campaign-service. The default-deny half is the deliberate part — a typo like `flase` is invisible
in a values.yaml diff, so an unrecognised value has to fail towards the path already known to work.

`LFX_CUTOVER_CAMPAIGN_SERVICE_DEMAND_GEN` is a CAPABILITY flag, not a routing one, and that is
why it is separate from the three above. They ask "should this go through campaign-service?"; it
asks "does the campaign-service we are actually talking to understand `googleAdsConfig.channel`?"
Those can be out of step, because the two services deploy independently.

Turning it on against a campaign-service that predates LFXV2-3257 is the failure it exists to
prevent, and that failure is SILENT. Go's JSON decoder ignores unknown keys, so an older service
drops `channel` and builds its default SEARCH campaign instead: real budget, no keywords, and by
its own documentation it "can never serve". Nothing errors — the job reports success, and the
wrong campaign is discovered later in Google Ads with money already spent.

There is no version probe because campaign-service exposes no version endpoint, and inferring
support from a successful create is exactly the ambiguity that makes this dangerous. So the order
is: deploy campaign-service with LFXV2-3257, confirm it, then set this. Left off, a Demand Gen
create is refused with a message telling the user to select Search instead.

`LFX_CUTOVER_CAMPAIGN_SERVICE_STATUS_TOGGLE` moves campaign pause/resume onto campaign-service,
and what it buys is REACH rather than a different backend. The path it replaces is a `switch` over
Meta and Reddit whose default arm throws, so pause was unavailable for every other platform no
matter what the allowlist said. Since pause is the primary cost-control lever on a mis-targeted or
overspending campaign, "cannot pause Google Ads from the product" meant logging into Google Ads.

**Turning it on does NOT give users a pause button.** It enables the SERVER path only. The app
cannot call it yet — pausing a campaign-service campaign needs its UUID, brief id and ETag, and
nothing in the UI can obtain any of them until the campaign read lands (LFXV2-3099). So the reach
above is reach the API gains, not a control the product grows. An operator flipping this expecting
a working pause control would find nothing changed on screen. Enable it when the UI half ships, or
earlier if you want the endpoint reachable for direct API use.

An overlapping rollout is SAFE here, and it is worth saying why, because the hazard recorded for
`LFX_CUTOVER_CAMPAIGN_SERVICE_JOBS` looks identical and is not. Routing runs a campaign-id SHAPE
check BEFORE and INDEPENDENTLY of this flag — that is the actual safety property. The two id
spaces are disjoint (campaign-service keys campaigns by UUID; the legacy path uses the ad
platform's numeric id), so no request can be claimed by both paths and a flag-on pod and a
flag-off pod cannot disagree about where one belongs. A flag-off pod handed a UUID refuses with a
clear error instead of answering the confident `not_found` that made the JOBS flag dangerous.

It is INERT until `LFX_CUTOVER_CAMPAIGN_SERVICE_CREATE` has been on long enough to produce
UUID-keyed campaigns, because a campaign only has a UUID if campaign-service created it. Enabling
it earlier is harmless, just useless.

`LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS` gates both halves of brief persistence: the write
(`POST /api/campaigns/brief/persist`, called when a user approves a brief and moves to the
Implementation tab) and the READ-BACK (`GET /api/campaigns/brief` and the Planning tab's restore
offer). With it off both answer "off" and call nothing; the brief stays where it has always
lived, in the browser tab, and is lost on reload.

Read and write share one flag deliberately — a pod that read while the write flag was off would
report an empty brief for one sitting in front of the user.

Because the read exists, an overlapping rollout is no longer free. Requests are not sticky, so a
lookup can land flag-off (brief not offered, user regenerates) while the following save lands
flag-on (finds the row, refuses as `unowned-brief-exists`). Confusing, but safe — nothing is
overwritten in either direction. Prefer a no-overlap rollout when flipping this flag; see
`values.yaml` for the detail.

Turning it off after it has been on leaves already-saved briefs untouched; they simply stop being
offered.

`..._BRIEFS` and `..._JOBS` are independent of each other and gate different endpoints: setting
`..._BRIEFS` does not route job polling anywhere new, and setting `..._JOBS` does not persist
anything.

**`..._CREATE` is not independent — it requires BOTH of the others.** `createCampaigns` gates on
all three together, so with either prerequisite off it reports disabled and every create silently
stays on the legacy path. Enabling CREATE alone, or CREATE+BRIEFS without JOBS, does nothing at
all.

- BRIEFS, because the create route is `/projects/{slug}/briefs/{brief_id}/campaigns` — there is no
  create-without-a-brief path, so without it there is no brief id to create from.
- JOBS, because a campaign-service create returns a job the client must then POLL.

### Rollout ordering (this order matters)

1. Turn **JOBS** on first and leave it on.
2. Then **BRIEFS**.
3. Then **CREATE**.

To roll back, reverse it: turn **CREATE** off first, and keep **JOBS** on until every outstanding
UUID job has drained.

The reason is the id-shape backstop. A poll reaches campaign-service only when the job id is a
UUID, which is the shape campaign-service mints; the legacy path mints `job_<epoch>_<rand>`. A pod
with JOBS **off** does not apply that check and sends the poll to its in-process map, where a UUID
job does not exist — so a job that is real and **spending** becomes unreportable. Turning CREATE on
before JOBS, or JOBS off while UUID jobs are still in flight, strands them exactly that way.

Before creation was cut over, JOBS on by itself was inert: no UUID job could exist, so every real
poll went to the in-process map regardless. That is no longer true once CREATE is on — do not read
"flag on, no errors" from that earlier era as a verified cutover.

Campaign traffic reaches campaign-service **through the gateway**, at `environment.LFX_V2_SERVICE`.
There is deliberately no chart parameter for a campaign-service base URL. The application does read
`LFX_V2_CAMPAIGN_SERVICE` and falls back to `LFX_V2_SERVICE` when it is unset — the same shape as
`LFX_V2_MEMBER_SERVICE` and `LFX_V2_COMMITTEE_SERVICE`, neither of which this chart declares either.
The fallback is what makes the gateway the default, and the gateway is where the authorization
lives: Heimdall and OpenFGA enforce `campaign_manager` on the project in front of campaign-service,
while the service's own token check authenticates the caller without authorizing them for that
project. A base URL aimed at a service instance would therefore let any caller with a valid token
act on a project it holds no grant for, given a job id.

Omitting the key from `values.yaml` does not by itself close that path — `templates/deployment.yaml`
emits every entry in `.Values.environment`, so an override adds the variable without touching this
chart. All three variables are therefore rejected at render time by
`lfx-self-serve.environment.gatewayOnlyValidate`, and `helm template` fails with the reason rather
than producing a pod that silently bypasses the gateway. Declaring the key with an empty value is
still fine: the container treats it as unset and the application resolves it to `LFX_V2_SERVICE`. A
deployment that genuinely needs a direct address should drop the variable from that list in a
reviewed chart commit — a values override is invisible to review, a chart change is not.

#### Marketing Ops FGA Enforcement

| Parameter                                   | Description                                                                                    | Required | Default |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- | ------- |
| `environment.LFX_MARKETING_OPS_FGA_ENABLED` | Gates FGA-based `marketing_auditor` / `campaign_manager` authorization on the marketing routes | No       | off     |

Same accepted-values and default-deny rules as the campaign-service cutover flags above. OFF (the
default) establishes an `executive_director`-only baseline: analytics routes already gated by
LFXV2-3294 preserve their prior behavior, while campaigns routes that previously had no
authorization middleware are intentionally tightened to ED-only. Deploying with the default value
still tightens authorization for campaigns — this is not a no-op rollback. ON adds a
root-writer bypass plus a root- or project-scoped `marketing_auditor` / `campaign_manager` FGA
grant as additional ways to pass — it never removes the existing ED path. LF Staff are not part
of what this flag adds: their bypass, where it exists at all, is wired per-endpoint (only the
analytics routes shared with the Marketing Overview widget, not Campaigns) and fires the same way
whether this flag is on or off.

This flag is deliberately independent of the client-side `marketing-ops-fga-enabled` OpenFeature
flag: the Web SDK never runs server-side, so a direct API caller with an FGA marketing relation
never executes the client-side UI guards at all — this server flag alone is what decides whether
that caller reaches the route. The client flag only controls whether a browser session shows the
Campaigns/Analytics affordance and lets its own route guards through; it has no effect on server
enforcement or on any non-browser caller. Both flags must be enabled for the feature to work
end-to-end through the UI, but the server flag is the only one that matters for a direct API call.

OFF by default is a hard requirement here, not a convenience default — the reverted PR #1112
caused a **total lockout for all users** when its UI guards shipped with no kill switch
(LFXV2-2231 gap-analysis G2). This flag lets a bad rollout be reverted with a value change, not a
revert PR. Unlike the campaign-service cutover flags, an overlapping rollout of THIS flag alone is
safe — no caller can be locked out — but it is not harmless: a caller who is ONLY an FGA
`marketing_auditor` / `campaign_manager` (no ED or root-writer persona, and not covered by an
`allowLfStaff` endpoint) will see a request succeed on a flag-on pod and get denied on a
flag-off pod purely depending on which pod answers. ED/root-writer callers, and LF Staff on the
endpoints that allow them, are unaffected either way, since those checks are reachable
regardless of this flag.

**Rollout ordering across the two flags (this order matters):**

1. Enable `LFX_MARKETING_OPS_FGA_ENABLED` and confirm the rolling update has fully converged — no
   pod still answering on the pre-flip image/config. A marketing-relation caller hitting a
   not-yet-converged pod during that window still falls back to the `executive_director`-only
   gate, which is a safe denial, not a lockout — but it does mean the client flag would be turning
   on a UI affordance (Campaigns/Analytics nav links) that some pods will still 403 on.
2. Only once the server flag has fully converged, enable the client-side
   `marketing-ops-fga-enabled` OpenFeature flag.

**Roll back in the opposite order:** disable the client flag first, confirm it, then disable the
server flag. Rolling the server flag back while the client flag is still on leaves the UI
advertising Campaigns/Analytics access to marketing-ops users that the BFF will now reject —
broken UX, not a security hazard, but avoidable by sequencing the rollback.

#### AI Service Configuration

| Parameter                  | Description                              | Required | Default |
| -------------------------- | ---------------------------------------- | -------- | ------- |
| `environment.AI_PROXY_URL` | AI service proxy URL (OpenAI compatible) | **Yes**  | -       |
| `environment.AI_API_KEY`   | API key for AI service                   | **Yes**  | -       |

#### Guild AI Integration

Server-side credentials for the Marketing OS agents proxy. Consumed only by the SSR server — never exposed to the browser.

| Parameter                                  | Description                                                                                                                                            | Required | Default                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------- |
| `environment.GUILD_API_URL`                | Guild API base URL                                                                                                                                     | No       | `https://app.guild.ai` |
| `environment.GUILD_API_KEY`                | API key for Guild workspace operations                                                                                                                 | **Yes**  | -                      |
| `environment.GUILD_WORKSPACE_OWNER`        | Guild workspace owner identifier                                                                                                                       | **Yes**  | -                      |
| `environment.GUILD_WORKSPACE_NAME`         | Guild workspace name                                                                                                                                   | **Yes**  | -                      |
| `environment.GUILD_STRUCTURED_AGENT_INPUT` | Send the Message Foundation intake as a structured Guild `agent_input` instead of BFF-rendered text                                                    | No       | `"false"`              |
| `environment.GITHUB_API_TOKEN`             | Token for the server-side README fetch. Unset uses unauthenticated GitHub (60 req/hour **per egress IP**); a public-repo token raises it to 5,000/hour | No       | -                      |

#### Runtime Client Configuration

| Parameter                     | Description                                                                                                                                                             | Required | Default           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------- |
| `environment.INTERCOM_APP_ID` | Public Intercom Messenger workspace App ID. Messenger loads only when set; identity verification uses the `http://lfx.dev/claims/intercom` Auth0 claim, not this value. | No       | - (Messenger off) |

#### Snowflake Analytics Configuration

Required for analytics endpoints (active-weeks-streak, pull-requests-merged, code-commits):

| Parameter                               | Description                                      | Required | Default  |
| --------------------------------------- | ------------------------------------------------ | -------- | -------- |
| `environment.SNOWFLAKE_ACCOUNT`         | Snowflake account identifier (org-account)       | **Yes**  | -        |
| `environment.SNOWFLAKE_USER`            | Snowflake service user for read-only queries     | **Yes**  | -        |
| `environment.SNOWFLAKE_ROLE`            | Snowflake user role with SELECT-only permissions | **Yes**  | -        |
| `environment.SNOWFLAKE_DATABASE`        | Snowflake analytics database name                | **Yes**  | -        |
| `environment.SNOWFLAKE_WAREHOUSE`       | Snowflake warehouse for query execution          | **Yes**  | -        |
| `environment.SNOWFLAKE_API_KEY`         | Snowflake private key for authentication         | **Yes**  | -        |
| `environment.SNOWFLAKE_LOG_LEVEL`       | Snowflake SDK log level                          | No       | `ERROR`  |
| `environment.SNOWFLAKE_LOCK_STRATEGY`   | Lock strategy for query deduplication            | No       | `memory` |
| `environment.SNOWFLAKE_MIN_CONNECTIONS` | Minimum connection pool size                     | No       | `2`      |
| `environment.SNOWFLAKE_MAX_CONNECTIONS` | Maximum connection pool size                     | No       | `10`     |

#### Logging Configuration

| Parameter               | Description                                | Required | Default |
| ----------------------- | ------------------------------------------ | -------- | ------- |
| `environment.LOG_LEVEL` | Application log level (info, debug, error) | No       | `info`  |

### Configuration Examples

#### Development Environment

```yaml
environment:
  NODE_ENV:
    value: 'development'
  ENV:
    value: 'development'
  LOG_LEVEL:
    value: 'debug'
  PCC_BASE_URL:
    value: 'http://localhost:4000'
  PCC_AUTH0_ISSUER_BASE_URL:
    value: 'https://linuxfoundation-dev.auth0.com/'
  LFX_V2_SERVICE:
    value: 'http://localhost:8080'
  NATS_URL:
    value: 'nats://localhost:4222'
```

#### Production Environment

```yaml
environment:
  NODE_ENV:
    value: 'production'
  ENV:
    value: 'production'
  LOG_LEVEL:
    value: 'info'
  PCC_BASE_URL:
    value: 'https://pcc.lfx.dev'
  PCC_AUTH0_ISSUER_BASE_URL:
    value: 'https://linuxfoundation.auth0.com/'
  LFX_V2_SERVICE:
    value: 'https://api.lfx.dev'
  NATS_URL:
    value: 'nats://nats-cluster:4222'
```

### Security Considerations

- **Always use Kubernetes secrets** for sensitive values like API keys, client secrets, and database credentials
- **Never commit secrets** to version control or include them in plain text in values files
- **Use separate Auth0 tenants** for different environments (dev, staging, production)
- **Rotate secrets regularly** and use different credentials for each environment
- **Limit API key permissions** to only what's necessary for the application to function

### Troubleshooting Environment Variables

Common issues and solutions:

1. **Auth0 callback errors**: Ensure `PCC_BASE_URL` matches the callback URL configured in Auth0
2. **Database connection errors**: Verify `SUPABASE_URL` and `POSTGRES_API_KEY` are correct
3. **API service errors**: Check that `LFX_V2_SERVICE` endpoint is accessible from the cluster
4. **NATS connection issues**: Ensure `NATS_URL` points to a reachable NATS server
5. **AI service failures**: Verify `AI_PROXY_URL` and `AI_API_KEY` are valid and have sufficient quota

### Service Parameters

| Parameter             | Description         | Default     |
| --------------------- | ------------------- | ----------- |
| `service.type`        | Service type        | `ClusterIP` |
| `service.port`        | Service port        | `80`        |
| `service.targetPort`  | Target port         | `4000`      |
| `service.annotations` | Service annotations | `{}`        |

### Ingress Parameters

| Parameter             | Description                 | Default |
| --------------------- | --------------------------- | ------- |
| `ingress.enabled`     | Enable ingress              | `false` |
| `ingress.className`   | Ingress class name          | `""`    |
| `ingress.annotations` | Ingress annotations         | `{}`    |
| `ingress.hosts`       | Ingress hosts configuration | `[]`    |
| `ingress.tls`         | Ingress TLS configuration   | `[]`    |

### External Secrets Operator Integration

This chart supports the [External Secrets Operator](https://external-secrets.io/) for managing secrets from external providers like AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, etc.

#### Prerequisites

1. Install the External Secrets Operator in your cluster:

   ```bash
   helm repo add external-secrets https://charts.external-secrets.io
   helm install external-secrets \
     external-secrets/external-secrets \
     -n external-secrets-system \
     --create-namespace
   ```

2. Configure appropriate IRSA (AWS), Workload Identity (GCP/Azure), or service account credentials for accessing your secret provider.

#### Configuration Parameters

| Parameter                                 | Description                                      | Default        |
| ----------------------------------------- | ------------------------------------------------ | -------------- |
| `externalSecrets.enabled`                 | Enable External Secrets integration              | `false`        |
| `externalSecrets.provider`                | Provider configuration (required when enabled)   | `{}`           |
| `externalSecrets.name`                    | Name of the ExternalSecret resource              | Auto-generated |
| `externalSecrets.target.name`             | Target Kubernetes Secret name (required)         | `""`           |
| `externalSecrets.target.template`         | Template for generating the secret content       | `{}`           |
| `externalSecrets.target.creationPolicy`   | Secret creation policy (Owner/Orphan/Merge/None) | `Owner`        |
| `externalSecrets.refreshInterval`         | How often to sync secrets from provider          | `10m`          |
| `externalSecrets.dataFrom`                | Fetch multiple secrets using queries (required)  | `[]`           |
| `externalSecrets.annotations`             | Annotations for ExternalSecret resource          | `{}`           |
| `externalSecrets.secretStore.name`        | Name of the SecretStore resource                 | Auto-generated |
| `externalSecrets.secretStore.annotations` | Annotations for SecretStore resource             | `{}`           |

#### Usage Examples

##### AWS Secrets Manager with IRSA

```yaml
externalSecrets:
  enabled: true
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: lfx-self-serve-sa # ServiceAccount with IRSA annotation
  target:
    name: lfx-self-serve
  dataFrom:
    - find:
        tags:
          service: lfx-self-serve
      rewrite:
        - merge: {}
```

#### Integration with Application

When External Secrets is enabled, the chart will:

1. Create a `SecretStore` resource configured with your provider
2. Create an `ExternalSecret` resource that fetches and syncs secrets
3. Generate a Kubernetes `Secret` with the fetched values

The application can then reference these secrets in environment variables:

```yaml
environment:
  PCC_AUTH0_CLIENT_SECRET:
    valueFrom:
      secretKeyRef:
        name: lfx-self-serve # Or your custom target name
        key: PCC_AUTH0_CLIENT_SECRET
```
