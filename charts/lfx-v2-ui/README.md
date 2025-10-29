# LFX One UI Helm Chart

This Helm chart deploys the LFX One UI application, which is an Angular SSR application with Express backend for LFX One.

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
  SNOWFLAKE_USERNAME:
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

| Parameter           | Description        | Default                             |
| ------------------- | ------------------ | ----------------------------------- |
| `replicaCount`      | Number of replicas | `1`                                 |
| `image.registry`    | Image registry     | `""`                                |
| `image.repository`  | Image repository   | `ghcr.io/linuxfoundation/lfx-v2-ui` |
| `image.tag`         | Image tag          | `"latest"`                          |
| `image.pullPolicy`  | Image pull policy  | `IfNotPresent`                      |
| `image.pullSecrets` | Image pull secrets | `[]`                                |

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

| Parameter                             | Description                                   | Required | Default               |
| ------------------------------------- | --------------------------------------------- | -------- | --------------------- |
| `environment.SUPABASE_URL`            | Supabase project URL                          | **Yes**  | -                     |
| `environment.POSTGRES_API_KEY`        | Supabase Postgres API key (anon/service role) | **Yes**  | -                     |
| `environment.SUPABASE_STORAGE_BUCKET` | Supabase storage bucket name                  | No       | `meeting-attachments` |

#### External Services

| Parameter                       | Description                            | Required | Default                                                          |
| ------------------------------- | -------------------------------------- | -------- | ---------------------------------------------------------------- |
| `environment.LFX_V2_SERVICE`    | LFX V2 API service endpoint            | **Yes**  | -                                                                |
| `environment.QUERY_SERVICE_URL` | Query service URL for resource queries | No       | `http://query-service.default.svc.cluster.local/query/resources` |
| `environment.NATS_URL`          | NATS messaging server URL              | **Yes**  | -                                                                |

#### AI Service Configuration

| Parameter                  | Description                              | Required | Default |
| -------------------------- | ---------------------------------------- | -------- | ------- |
| `environment.AI_PROXY_URL` | AI service proxy URL (OpenAI compatible) | **Yes**  | -       |
| `environment.AI_API_KEY`   | API key for AI service                   | **Yes**  | -       |

#### Snowflake Analytics Configuration

Required for analytics endpoints (active-weeks-streak, pull-requests-merged, code-commits):

| Parameter                               | Description                                      | Required | Default  |
| --------------------------------------- | ------------------------------------------------ | -------- | -------- |
| `environment.SNOWFLAKE_ACCOUNT`         | Snowflake account identifier (org-account)       | **Yes**  | -        |
| `environment.SNOWFLAKE_USERNAME`        | Snowflake service user for read-only queries     | **Yes**  | -        |
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
            name: lfx-v2-ui-sa # ServiceAccount with IRSA annotation
  target:
    name: lfx-v2-ui
  dataFrom:
    - find:
        tags:
          service: lfx-v2-ui
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
        name: lfx-v2-ui # Or your custom target name
        key: PCC_AUTH0_CLIENT_SECRET
```
