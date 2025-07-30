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

| Parameter           | Description        | Default                                 |
| ------------------- | ------------------ | --------------------------------------- |
| `replicaCount`      | Number of replicas | `1`                                     |
| `image.registry`    | Image registry     | `""`                                    |
| `image.repository`  | Image repository   | `ghcr.io/linuxfoundation/lfx-v2-pcc-ui` |
| `image.tag`         | Image tag          | `"latest"`                              |
| `image.pullPolicy`  | Image pull policy  | `IfNotPresent`                          |
| `image.pullSecrets` | Image pull secrets | `[]`                                    |

### Environment Variables

| Parameter                       | Description         | Required | Default                                   |
| ------------------------------- | ------------------- | -------- | ----------------------------------------- |
| `environment.ENV`               | Environment name    | Yes      | `"production"`                            |
| `environment.QUERY_SERVICE_URL` | Query service URL   | No       | `"http://localhost:8080/query/resources"` |
| `environment.NODE_ENV`          | Node.js environment | No       | `"production"`                            |
| `environment.PORT`              | Application port    | No       | `"4000"`                                  |

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
