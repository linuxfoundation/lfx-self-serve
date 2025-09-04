# LFX V2 PCC UI Helm Chart

This Helm chart deploys the LFX V2 PCC UI application, which is an Angular SSR application with Express backend for the LFX Project Control Center.

## Configuration

### Required Configuration

The following values must be configured before deployment:

```yaml
environment:
  PCC_BASE_URL:
    value: ''
  PCC_AUTH0_CLIENT_ID:
    value: ''
  PCC_AUTH0_CLIENT_SECRET:
    value: ''
  SUPABASE_URL:
    value: ''
  POSTGRES_API_KEY:
    value: ''
```

These can also be set from a secret

```yaml
POSTGRES_API_KEY:
  value: ''
  valueFrom:
    secretKeyRef:
      name: pcc-env-secrets
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

| Parameter                               | Description                        | Required | Default                                                          |
| --------------------------------------- | ---------------------------------- | -------- | ---------------------------------------------------------------- |
| `environment.NODE_ENV`                  | Node.js environment                | No       | `production`                                                     |
| `environment.PORT`                      | Application port                   | No       | `4000`                                                           |
| `environment.COREPACK_HOME`             | Corepack cache directory           | No       | `/home/appuser/.cache/node/corepack`                             |
| `environment.XDG_CACHE_HOME`            | XDG cache directory                | No       | `/home/appuser/.cache`                                           |
| `environment.TMPDIR`                    | Temporary directory                | No       | `/tmp`                                                           |
| `environment.PCC_BASE_URL`              | Base URL for the PCC application   | Yes      | `https://pcc.k8s.orb.local`                                      |
| `environment.PCC_AUTH0_ISSUER_BASE_URL` | Auth0 issuer base URL              | No       | `https://linuxfoundation-dev.auth0.com/`                         |
| `environment.PCC_AUTH0_AUDIENCE`        | Auth0 audience                     | No       | `https://api-gw.dev.platform.linuxfoundation.org/`               |
| `environment.ENV`                       | Environment name                   | Yes      | `production`                                                     |
| `environment.QUERY_SERVICE_URL`         | Query service URL                  | No       | `http://query-service.default.svc.cluster.local/query/resources` |
| `environment.PCC_AUTH0_CLIENT_ID`       | Auth0 client ID (secret)           | Yes      |                                                                  |
| `environment.PCC_AUTH0_CLIENT_SECRET`   | Auth0 client secret (secret)       | Yes      |                                                                  |
| `environment.SUPABASE_URL`              | Supabase URL (secret)              | Yes      |                                                                  |
| `environment.POSTGRES_API_KEY`          | Supabase Postgres API key (secret) | Yes      |                                                                  |

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

| Parameter                                  | Description                                          | Default        |
| ------------------------------------------ | ---------------------------------------------------- | -------------- |
| `externalSecrets.enabled`                  | Enable External Secrets integration                  | `false`        |
| `externalSecrets.provider`                 | Provider configuration (required when enabled)       | `{}`           |
| `externalSecrets.name`                     | Name of the ExternalSecret resource                  | Auto-generated |
| `externalSecrets.target`                   | Target Kubernetes Secret name (required)             | `""`           |
| `externalSecrets.refreshInterval`          | How often to sync secrets from provider              | `10m`          |
| `externalSecrets.creationPolicy`           | Secret creation policy (Owner/Orphan/Merge/None)     | `Owner`        |
| `externalSecrets.dataFrom`                 | Fetch multiple secrets using queries (required)      | `[]`           |
| `externalSecrets.annotations`              | Annotations for ExternalSecret resource              | `{}`           |
| `externalSecrets.secretStore.name`         | Name of the SecretStore resource                     | Auto-generated |
| `externalSecrets.secretStore.annotations`  | Annotations for SecretStore resource                 | `{}`           |

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
            name: lfx-v2-ui-sa  # ServiceAccount with IRSA annotation
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
        name: lfx-v2-ui  # Or your custom target name
        key: PCC_AUTH0_CLIENT_SECRET
```
