# Runtime Configuration Injection

This document describes how client-side configuration values (LaunchDarkly, DataDog RUM, etc.) are injected at **runtime** instead of build time, allowing a single Docker image to be deployed across all environments.

## Overview

Runtime configuration values are:

- **Injected at container startup** via environment variables
- **Transferred from server to browser** using Angular's TransferState
- **Not baked into the Docker image** during build
- **Environment-specific** without requiring separate builds

**Examples:** LaunchDarkly client ID, DataDog RUM client token

## Architecture

### Data Flow

```text
Container Start (ENV vars: LD_CLIENT_ID, DD_RUM_CLIENT_ID, etc.)
        │
        ▼
Express Server reads process.env
        │
        ▼
SSR Request → server.ts builds RuntimeConfig object
        │
        ▼
Angular SSR renders → REQUEST_CONTEXT contains runtimeConfig
        │
        ▼
provideRuntimeConfig() stores config in TransferState
        │
        ▼
HTML sent to browser with TransferState serialized
        │
        ▼
Browser hydrates → TransferState contains config
        │
        ▼
provideFeatureFlags() reads config from TransferState
        │
        ▼
LaunchDarkly/DataDog initialize with runtime values
```

### Provider Architecture

The runtime configuration system uses two providers:

```text
┌─────────────────────────────────────────────────────────────┐
│                     app.config.ts                            │
├─────────────────────────────────────────────────────────────┤
│  providers: [                                                │
│    ...                                                       │
│    provideRuntimeConfig(),  // Must be first                │
│    provideFeatureFlags(),   // Uses runtime config          │
│    // provideDataDog(),     // Future: will use config      │
│  ]                                                           │
└─────────────────────────────────────────────────────────────┘
```

1. **`runtime-config.provider.ts`**: Sets up TransferState with config from server
2. **`feature-flag.provider.ts`**: Reads config and initializes LaunchDarkly
3. **Future providers**: Can use the same pattern for DataDog, analytics, etc.

## Implementation Details

### RuntimeConfig Interface

**File:** `packages/shared/src/interfaces/runtime-config.interface.ts`

```typescript
export interface RuntimeConfig {
  launchDarklyClientId: string;
  dataDogRumClientId: string;
  dataDogRumApplicationId: string;
}
```

### Server-Side Configuration

**File:** `apps/lfx-one/src/server/server.ts`

The Express server reads environment variables and passes them to Angular:

```typescript
// Build runtime config from environment variables
const runtimeConfig: RuntimeConfig = {
  launchDarklyClientId: process.env['LD_CLIENT_ID'] || '',
  dataDogRumClientId: process.env['DD_RUM_CLIENT_ID'] || '',
  dataDogRumApplicationId: process.env['DD_RUM_APPLICATION_ID'] || '',
};

angularApp.handle(req, {
  auth,
  runtimeConfig, // Passed via REQUEST_CONTEXT
  providers: [
    { provide: APP_BASE_HREF, useValue: process.env['PCC_BASE_URL'] },
    { provide: REQUEST, useValue: req },
  ],
});
```

### Runtime Config Provider

**File:** `apps/lfx-one/src/app/shared/providers/runtime-config.provider.ts`

```typescript
async function initializeRuntimeConfig(): Promise<void> {
  const transferState = inject(TransferState);
  const reqContext = inject(REQUEST_CONTEXT, { optional: true });

  // Server-side: Store config to TransferState for browser hydration
  if (reqContext?.runtimeConfig) {
    transferState.set(RUNTIME_CONFIG_KEY, reqContext.runtimeConfig);
  }
}

export const provideRuntimeConfig = (): EnvironmentProviders => provideAppInitializer(initializeRuntimeConfig);
```

### Feature Flag Provider

**File:** `apps/lfx-one/src/app/shared/providers/feature-flag.provider.ts`

```typescript
async function initializeOpenFeature(): Promise<void> {
  // Skip on server - LaunchDarkly is browser-only
  if (typeof window === 'undefined') {
    return;
  }

  const transferState = inject(TransferState);
  const runtimeConfig = getRuntimeConfig(transferState);
  const clientId = runtimeConfig.launchDarklyClientId;

  if (!clientId) {
    console.warn('LaunchDarkly client ID not configured');
    return;
  }

  // Initialize LaunchDarkly with runtime client ID
  const provider = new LaunchDarklyClientProvider(clientId, { ... });
  await OpenFeature.setProviderAndWait(provider);
}
```

## Environment Variables

### Required Variables

| Variable                | Description                         | Example                    |
| ----------------------- | ----------------------------------- | -------------------------- |
| `LD_CLIENT_ID`          | LaunchDarkly client-side ID         | `691b727361cbf309e9d74468` |
| `DD_RUM_CLIENT_ID`      | DataDog RUM client token (future)   | `pub123456789`             |
| `DD_RUM_APPLICATION_ID` | DataDog RUM application ID (future) | `app-uuid-here`            |

### Local Development

Add to your `.env` file (already gitignored):

```bash
# Runtime Client IDs for local development
LD_CLIENT_ID=your-launchdarkly-dev-client-id
DD_RUM_CLIENT_ID=your-datadog-rum-client-token
DD_RUM_APPLICATION_ID=your-datadog-rum-app-id
```

The server reads these via `dotenv` in development mode:

```typescript
if (process.env['NODE_ENV'] !== 'production') {
  dotenv.config();
}
```

### Docker Deployment

Pass environment variables at container runtime:

```bash
docker run \
  -e LD_CLIENT_ID=prod-client-id \
  -e DD_RUM_CLIENT_ID=prod-rum-token \
  -e DD_RUM_APPLICATION_ID=prod-rum-app-id \
  ghcr.io/linuxfoundation/lfx-v2-ui:latest
```

### Kubernetes Deployment

Configure in your Kubernetes manifests or Helm values:

```yaml
env:
  - name: LD_CLIENT_ID
    valueFrom:
      secretKeyRef:
        name: lfx-one-secrets
        key: launchdarkly-client-id
  - name: DD_RUM_CLIENT_ID
    valueFrom:
      secretKeyRef:
        name: lfx-one-secrets
        key: datadog-rum-client-id
```

## Benefits

### Single Docker Image

Build once, deploy anywhere:

```bash
# Same image for all environments
docker build -t lfx-one .

# Development
docker run -e LD_CLIENT_ID=dev-id lfx-one

# Staging
docker run -e LD_CLIENT_ID=staging-id lfx-one

# Production
docker run -e LD_CLIENT_ID=prod-id lfx-one
```

### No Secrets in Code

- Client IDs never committed to repository
- No secrets baked into Docker layers
- Configuration managed via environment

### Extensible Pattern

Add new runtime configurations easily:

1. Add property to `RuntimeConfig` interface
2. Read from `process.env` in `server.ts`
3. Access via `getRuntimeConfig(transferState)` in your provider

## Adding New Runtime Configuration

### Step 1: Update Interface

```typescript
// packages/shared/src/interfaces/runtime-config.interface.ts
export interface RuntimeConfig {
  launchDarklyClientId: string;
  dataDogRumClientId: string;
  dataDogRumApplicationId: string;
  newServiceClientId: string; // Add new property
}
```

### Step 2: Update Server

```typescript
// apps/lfx-one/src/server/server.ts
const runtimeConfig: RuntimeConfig = {
  launchDarklyClientId: process.env['LD_CLIENT_ID'] || '',
  dataDogRumClientId: process.env['DD_RUM_CLIENT_ID'] || '',
  dataDogRumApplicationId: process.env['DD_RUM_APPLICATION_ID'] || '',
  newServiceClientId: process.env['NEW_SERVICE_CLIENT_ID'] || '', // Add
};
```

### Step 3: Update Default Config

```typescript
// apps/lfx-one/src/app/shared/providers/runtime-config.provider.ts
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  launchDarklyClientId: '',
  dataDogRumClientId: '',
  dataDogRumApplicationId: '',
  newServiceClientId: '', // Add
};
```

### Step 4: Create Provider (if needed)

```typescript
// apps/lfx-one/src/app/shared/providers/new-service.provider.ts
async function initializeNewService(): Promise<void> {
  if (typeof window === 'undefined') return;

  const transferState = inject(TransferState);
  const config = getRuntimeConfig(transferState);

  if (!config.newServiceClientId) return;

  // Initialize your service
}

export const provideNewService = (): EnvironmentProviders => provideAppInitializer(initializeNewService);
```

### Step 5: Register Provider

```typescript
// apps/lfx-one/src/app/app.config.ts
providers: [
  provideRuntimeConfig(),
  provideFeatureFlags(),
  provideNewService(), // Add after provideRuntimeConfig
];
```

### Step 6: Update .env.example

```bash
# apps/lfx-one/.env.example
NEW_SERVICE_CLIENT_ID=your-new-service-client-id
```

## Troubleshooting

### Config Not Available in Browser

**Symptom:** `getRuntimeConfig()` returns default values

**Possible Causes:**

1. `provideRuntimeConfig()` not included in `app.config.ts`
2. `provideRuntimeConfig()` not before other providers that use it
3. Environment variable not set on server

**Solution:**

- Ensure provider order: `provideRuntimeConfig()` before `provideFeatureFlags()`
- Verify environment variable is set: `echo $LD_CLIENT_ID`
- Check server logs for config being passed

### TransferState Not Hydrating

**Symptom:** Config works on server but not browser

**Possible Causes:**

1. SSR not enabled
2. TransferState not serialized in HTML
3. Browser hydration disabled

**Solution:**

- Verify `provideClientHydration()` is in `app.config.ts`
- Check HTML source for `<script id="serverApp-state">` tag
- Ensure `withIncrementalHydration()` is configured

### Missing Environment Variable

**Symptom:** Warning "LaunchDarkly client ID not configured"

**Solution:**

1. **Local development:** Add to `.env` file
2. **Docker:** Pass with `-e LD_CLIENT_ID=xxx`
3. **Kubernetes:** Configure in deployment manifest

## Migration from Build-Time Injection

If migrating from the previous build-time approach:

1. **Remove** `LAUNCHDARKLY_CLIENT_ID` from `angular.json` define blocks
2. **Remove** `launchDarklyClientId` from environment files
3. **Remove** `declare const LAUNCHDARKLY_CLIENT_ID` from environment files
4. **Update** Dockerfile to remove `--mount=type=secret` for client IDs
5. **Update** GitHub workflows to remove AWS Secrets Manager steps for client IDs
6. **Add** environment variables to deployment configuration

## Related Documentation

- [Feature Flags](./architecture/frontend/feature-flags.md) - LaunchDarkly integration details
- [Deployment Guide](./deployment.md) - Deployment processes and environments
- [SSR Server](./architecture/backend/ssr-server.md) - Server-side rendering architecture
