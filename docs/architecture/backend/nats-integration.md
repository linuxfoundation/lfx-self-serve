# NATS Integration

## 🚀 Overview

The LFX One application integrates with **NATS** (Neural Autonomic Transport System) for high-performance inter-service messaging within the LFX microservices ecosystem. NATS provides lightweight, publish-subscribe, and request-reply communication patterns for distributed systems.

## 🏗 Architecture

### NATS Integration Pattern

```text
LFX One ←→ NATS Server ←→ LFX Microservices
    ↓          ↓              ↓
  Client    Message         Project
  Requests   Broker         Services
```

### Core Components

- **NATS Service** (`/server/services/nats.service.ts`): Core NATS client implementation
- **Project Service Integration**: Uses NATS for project slug resolution
- **Lazy Connection Management**: On-demand connection with automatic reconnection
- **Request-Reply Pattern**: Synchronous communication with timeout handling

## 🔧 Implementation Details

### NATS Service Configuration

```typescript
export class NatsService {
  private connection: NatsConnection | null = null;
  private connectionPromise: Promise<NatsConnection> | null = null;
  private codec = StringCodec();

  public constructor() {
    // Lazy initialization - no immediate connection
  }
}
```

### Connection Management

#### Lazy Connection Strategy

```typescript
private async ensureConnection(): Promise<NatsConnection> {
  // Return existing connection if valid
  if (this.connection && !this.connection.isClosed()) {
    return this.connection;
  }

  // If already connecting, wait for that connection
  if (this.connectionPromise) {
    return this.connectionPromise;
  }

  // Create new connection with thread safety
  this.connectionPromise = this.createConnection();

  try {
    this.connection = await this.connectionPromise;
    return this.connection;
  } finally {
    this.connectionPromise = null;
  }
}
```

#### Connection Configuration

```typescript
private async createConnection(): Promise<NatsConnection> {
  const natsUrl = process.env['NATS_URL'] || NATS_CONFIG.DEFAULT_SERVER_URL;

  const connection = await connect({
    servers: [natsUrl],
    timeout: NATS_CONFIG.CONNECTION_TIMEOUT, // 5000ms
  });

  return connection;
}
```

## 📡 Message Subjects and Patterns

### Defined Subjects

```typescript
export enum NatsSubjects {
  PROJECT_SLUG_TO_UID = 'lfx.projects-api.slug_to_uid',
}
```

### Request-Reply Pattern

```typescript
public async getProjectIdBySlug(slug: string): Promise<ProjectSlugToIdResponse> {
  const connection = await this.ensureConnection();

  const response = await connection.request(
    NatsSubjects.PROJECT_SLUG_TO_UID,
    this.codec.encode(slug),
    { timeout: NATS_CONFIG.REQUEST_TIMEOUT } // 5000ms
  );

  const projectId = this.codec.decode(response.data);

  return {
    projectId: projectId.trim(),
    slug,
    exists: projectId.trim() !== ''
  };
}
```

## 🔗 Service Integration

### Project Service Integration

```typescript
export class ProjectService {
  private natsService: NatsService;

  public constructor() {
    this.natsService = new NatsService();
  }

  public async getProjectBySlug(req: Request, slug: string): Promise<Project> {
    // Use NATS to resolve project slug to ID
    const { projectId, exists } = await this.natsService.getProjectIdBySlug(slug);

    if (!exists) {
      throw createApiError({
        message: 'Project not found',
        status: 404,
        code: 'PROJECT_NOT_FOUND',
      });
    }

    // Use resolved ID to fetch project details
    return this.getProjectById(req, projectId);
  }
}
```

## ⚙️ Configuration

### Environment Variables

```bash
# NATS Configuration
# Internal k8s service DNS for NATS cluster
NATS_URL=nats://lfx-platform-nats.lfx.svc.cluster.local:4222
```

### NATS Configuration Constants

```typescript
export const NATS_CONFIG = {
  /**
   * Default NATS server URL for Kubernetes cluster
   */
  DEFAULT_SERVER_URL: 'nats://lfx-platform-nats.lfx.svc.cluster.local:4222',

  /**
   * Connection timeout in milliseconds
   */
  CONNECTION_TIMEOUT: 5000,

  /**
   * Request timeout in milliseconds
   */
  REQUEST_TIMEOUT: 5000,
} as const;
```

## 🔐 Security and Error Handling

### Connection Security

- **Kubernetes Service DNS**: Uses internal cluster DNS for secure communication
- **Network Policies**: Security enforced at Kubernetes network level
- **Connection Pooling**: Single connection per service instance
- **Service Mesh Integration**: Compatible with Istio/Linkerd if deployed

### Error Handling Strategy

```typescript
try {
  const response = await connection.request(subject, data, { timeout });
  return this.processResponse(response);
} catch (error) {
  // Handle timeout and no responder errors gracefully
  if (error.message.includes('timeout') || error.message.includes('503')) {
    serverLogger.info({ slug }, 'Project slug not found via NATS');
    return { exists: false, projectId: '', slug };
  }

  // Re-throw connection and other critical errors
  throw error;
}
```

### Graceful Shutdown

```typescript
public async shutdown(): Promise<void> {
  if (this.connection && !this.connection.isClosed()) {
    serverLogger.info('Shutting down NATS connection');

    try {
      await this.connection.drain(); // Graceful shutdown
      serverLogger.info('NATS connection closed successfully');
    } catch (error) {
      serverLogger.error({ error }, 'Error during NATS shutdown');
    }
  }
  this.connection = null;
}
```

## 📊 Monitoring and Logging

### Connection Monitoring

```typescript
public isConnected(): boolean {
  return this.connection !== null && !this.connection.isClosed();
}
```

### Request Logging

```typescript
// Success logging
serverLogger.info({ slug, project_id: projectId }, 'Successfully resolved project slug to ID');

// Error logging
serverLogger.error({ error, slug }, 'Failed to resolve project slug via NATS');

// Connection logging
serverLogger.info({ url: natsUrl }, 'Connecting to NATS server on demand');
```

### Health Check Integration

```typescript
// Health endpoint includes NATS status
app.get('/api/health', (req, res) => {
  const healthStatus = {
    nats: {
      connected: natsService.isConnected(),
      url: process.env['NATS_URL'] || NATS_CONFIG.DEFAULT_SERVER_URL,
    },
  };
  res.json(healthStatus);
});
```

## 🔧 Development and Troubleshooting

### Local Development Setup

Since NATS runs in the local Kubernetes cluster, the application connects directly using the Kubernetes service DNS:

```bash
# Environment configuration for local development
NATS_URL=nats://lfx-platform-nats.lfx.svc.cluster.local:4222
```

### Kubernetes Service Discovery

The application leverages Kubernetes service discovery:

- **Service Name**: `lfx-platform-nats`
- **Namespace**: `lfx`
- **Port**: `4222`
- **Full DNS**: `lfx-platform-nats.lfx.svc.cluster.local:4222`

### Common Issues and Solutions

#### 1. DNS Resolution Issues

```text
Error: getaddrinfo ENOTFOUND lfx-platform-nats.lfx.svc.cluster.local
Cause: Kubernetes DNS not accessible or service not running
Solution: Verify NATS service is deployed and accessible in cluster
```

#### 2. Connection Timeout

```text
Error: Failed to connect to NATS server
Cause: NATS server not responding or network issues
Solution: Check NATS pod status and network policies
```

#### 3. Request Timeout

```text
Error: Request timeout on NATS subject
Cause: No service responding to the subject or high latency
Solution: Verify target microservice deployment and health
```

### Debugging Commands

```bash
# Check NATS pod status
kubectl get pods -n lfx -l app=nats

# Check NATS service
kubectl get svc -n lfx lfx-platform-nats

# Check NATS logs
kubectl logs -n lfx deployment/lfx-platform-nats

# Test NATS connectivity from within cluster
kubectl run nats-test --rm -i --tty --image=natsio/nats-box -- nats pub test "hello"
```

## 🎯 Best Practices

### Performance Optimization

1. **Lazy Connection**: Connect only when needed to reduce startup time
2. **Connection Reuse**: Single connection per service instance
3. **Request Timeouts**: Always use timeouts to prevent hanging requests
4. **Graceful Shutdown**: Properly drain connections on service shutdown

### Error Handling

1. **Timeout Handling**: Treat timeouts as "not found" for optional data
2. **Circuit Breaking**: Implement circuit breaker for degraded service scenarios
3. **Fallback Strategies**: Provide alternative data sources when NATS is unavailable
4. **Retry Logic**: Consider exponential backoff for transient failures

### Code Quality

1. **Type Safety**: Use TypeScript interfaces for message payloads
2. **Subject Constants**: Define subjects as enums to prevent typos
3. **Error Logging**: Log all NATS operations with appropriate context
4. **Unit Testing**: Mock NATS connections for comprehensive testing

## 📈 Performance Metrics

### Key Metrics to Monitor

- **Connection Status**: Track connection health and reconnections
- **Request Latency**: Monitor request-reply response times
- **Error Rate**: Track timeout and connection failures
- **Message Volume**: Monitor message throughput and patterns

### Request Performance Logging

```typescript
// Request timing and metrics
const startTime = Date.now();
try {
  const response = await connection.request(subject, data, { timeout });
  const duration = Date.now() - startTime;

  serverLogger.info(
    {
      subject,
      duration,
      success: true,
      slug,
    },
    'NATS request completed successfully'
  );

  return response;
} catch (error) {
  const duration = Date.now() - startTime;

  serverLogger.error(
    {
      subject,
      duration,
      success: false,
      error: error.message,
      slug,
    },
    'NATS request failed'
  );

  throw error;
}
```

## 🔗 Related Documentation

- [Backend Architecture Overview](./README.md)
- [Project Service Integration](../../CLAUDE.md#backend-stack)
- [Environment Configuration](../../deployment.md#environment-variables)
- [Microservice Proxy Service](./README.md#microservice-integration)

## 📚 External Resources

- [NATS.io Documentation](https://docs.nats.io/)
- [NATS TypeScript Client](https://github.com/nats-io/nats.js)
- [NATS Request-Reply Pattern](https://docs.nats.io/nats-concepts/reqreply)
- [Kubernetes Service Discovery](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)
