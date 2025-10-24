# Snowflake Integration

## 🚀 Overview

The LFX One application integrates with **Snowflake** for read-only analytical queries against the DBT (Data Build Tool) data warehouse. This integration provides high-performance data access with enterprise-grade security, connection pooling, and intelligent query deduplication to optimize resource utilization and reduce costs.

### Key Features

- **Read-Only Access**: Multi-layer enforcement ensures only SELECT queries execute
- **SQL Injection Protection**: Parameterized queries with strict validation
- **Connection Pooling**: Efficient resource management with configurable pool sizing
- **Query Deduplication**: Intelligent fetch lock prevents duplicate execution of identical queries
- **Private Key Authentication**: Secure JWT-based authentication
- **Future-Ready**: Redis-ready architecture for distributed locking across service instances

## 🏗 Architecture

### Snowflake Integration Pattern

```text
LFX One ←→ Snowflake Service ←→ Connection Pool ←→ Snowflake DBT
    ↓              ↓                    ↓                ↓
Analytics      Query             Connection        Data
Services    Deduplication         Management      Warehouse
               (Lock Manager)
```

### Core Components

- **Snowflake Service** (`/server/services/snowflake.service.ts`): Main service managing queries, pooling, and security
- **Lock Manager** (`/server/utils/lock-manager.ts`): Query deduplication utility with in-memory and Redis strategies
- **Connection Pool**: Snowflake SDK managed pool for concurrent query execution
- **Shared Interfaces** (`@lfx-one/shared`): TypeScript interfaces, constants, and enums

## 🔧 Implementation Details

### Snowflake Service Architecture

```typescript
export class SnowflakeService {
  private pool: Pool<Connection> | null = null;
  private poolPromise: Promise<Pool<Connection>> | null = null;
  private lockManager: LockManager;

  public constructor() {
    // Lazy initialization - pool created on first query
    const lockStrategy = (process.env['SNOWFLAKE_LOCK_STRATEGY'] || 'memory') as SnowflakeLockStrategy;
    this.lockManager = new LockManager(lockStrategy);
  }
}
```

## 🏊 Connection Pooling

### Pool Configuration

The service uses Snowflake SDK's connection pooling for efficient resource management:

```typescript
private async createPool(): Promise<Pool<Connection>> {
  // Method 1: Try direct env var first (for containerized deployments)
  let privateKey: string | undefined = process.env['SNOWFLAKE_API_KEY'];

  // Method 2: Fall back to rsa_key.p8 file in app root (same location as .env)
  if (!privateKey) {
    const privateKeyPath = path.join(__dirname, '../../../rsa_key.p8');

    if (!existsSync(privateKeyPath)) {
      throw new Error('Either SNOWFLAKE_API_KEY or rsa_key.p8 file must be present');
    }

    const privateKeyFile = readFileSync(privateKeyPath);

    const privateKeyObject = crypto.createPrivateKey({
      key: privateKeyFile,
      format: 'pem',
      passphrase: process.env['SNOWFLAKE_PRIVATE_KEY_PASSPHRASE'],
    });

    privateKey = privateKeyObject.export({
      format: 'pem',
      type: 'pkcs8',
    }) as string;
  }

  const connectionOptions: ConnectionOptions = {
    account: process.env['SNOWFLAKE_ACCOUNT'] as string,
    username: process.env['SNOWFLAKE_USERNAME'] as string,
    role: process.env['SNOWFLAKE_ROLE'] as string,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey: privateKey,
    schema: 'PUBLIC', // Hardcoded schema
    database: process.env['SNOWFLAKE_DATABASE'] as string,
    warehouse: process.env['SNOWFLAKE_WAREHOUSE'] as string,
    timeout: SNOWFLAKE_CONFIG.CONNECTION_TIMEOUT,
  };

  const poolOptions: PoolOptions = {
    max: Number(process.env['SNOWFLAKE_MAX_CONNECTIONS']) || SNOWFLAKE_CONFIG.MAX_CONNECTIONS,
    min: Number(process.env['SNOWFLAKE_MIN_CONNECTIONS']) || SNOWFLAKE_CONFIG.MIN_CONNECTIONS,
  };

  const pool = createPool(connectionOptions, poolOptions);

  return pool;
}
```

### Pool Benefits

- **Concurrent Execution**: Multiple queries execute simultaneously without blocking
- **Resource Optimization**: Reuses connections instead of creating new ones
- **Auto-Management**: SDK handles connection health, timeouts, and lifecycle
- **Graceful Degradation**: Configurable behavior when pool exhausted

### Pool Monitoring

The Snowflake SDK uses the `generic-pool` library which exposes the following properties:

- **`borrowed`** - Resources currently in use
- **`available`** - Unused resources in the pool
- **`pending`** - Callers waiting to acquire a resource
- **`size`** - Total resources (borrowed + available)

```typescript
/**
 * Get connection pool statistics
 *
 * Maps generic-pool properties to our interface:
 * - borrowed → activeConnections (resources currently in use)
 * - available → idleConnections (unused resources in pool)
 * - pending → waitingRequests (callers waiting for a resource)
 * - size → totalConnections (total resources: borrowed + available)
 */
public getPoolStats(): SnowflakePoolStats {
  if (!this.pool) {
    return {
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
      totalConnections: 0,
    };
  }

  // Snowflake SDK uses generic-pool which exposes: borrowed, available, pending, size
  const poolAny = this.pool as any;

  return {
    activeConnections: poolAny.borrowed || 0,
    idleConnections: poolAny.available || 0,
    waitingRequests: poolAny.pending || 0,
    totalConnections: poolAny.size || 0,
  };
}
```

## 🔒 Query Deduplication (Fetch Lock)

### Problem Statement

When multiple callers request the same data simultaneously (cache stampede), we want to execute the query once and share the result rather than hitting Snowflake multiple times with identical queries.

### Solution Architecture

```text
Request 1 (SELECT * FROM projects WHERE id = '123') ──┐
                                                       ├──> Query Hash ──> Check Lock
Request 2 (SELECT * FROM projects WHERE id = '123') ──┤         ↓              ↓
                                                       │    [abc123hash]   Lock Exists?
Request 3 (SELECT * FROM projects WHERE id = '123') ──┘         ↓              ↓
                                                            If EXISTS:     If NEW:
                                                            Return         Execute Query
                                                            Existing       Store Promise
                                                            Promise        Share Result
                                                                ↓              ↓
                                                            All requests get same result
```

### Query Hash Generation

```typescript
// In lock-manager.ts
public hashQuery(sqlText: string, binds?: (Bind | Date)[]): string {
  const normalized = {
    sql: sqlText.trim().toLowerCase().replace(/\s+/g, ' '),
    binds: this.normalizeBinds(binds),
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}

private normalizeBinds(binds?: (Bind | Date)[]): Bind[] {
  if (!binds) return [];

  return binds.map((bind) => {
    if (bind instanceof Date) {
      return bind.toISOString();
    }
    return bind;
  });
}
```

### Lock Manager Implementation

```typescript
// /server/utils/lock-manager.ts
export class LockManager {
  private strategy: SnowflakeLockStrategy;
  private memoryLocks: Map<string, LockEntry>;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(strategy: SnowflakeLockStrategy = SnowflakeLockStrategy.MEMORY) {
    this.strategy = strategy;
    this.memoryLocks = new Map();

    if (strategy === SnowflakeLockStrategy.MEMORY) {
      this.startCleanup();
    }

    // Future Redis integration:
    // if (strategy === SnowflakeLockStrategy.REDIS) {
    //   this.redisClient = new Redis(process.env['REDIS_URL']);
    // }
  }

  async executeLocked<T>(key: string, executor: () => Promise<T>): Promise<T> {
    if (this.strategy === SnowflakeLockStrategy.MEMORY) {
      return this.executeLockedMemory(key, executor);
    }

    // Future Redis implementation:
    // return this.executeLockedRedis(key, executor);

    throw new Error(`Unsupported lock strategy: ${this.strategy}`);
  }

  private async executeLockedMemory<T>(key: string, executor: () => Promise<T>): Promise<T> {
    const existing = this.memoryLocks.get(key);

    if (existing) {
      // Query already executing - wait for it
      existing.waiters++;
      serverLogger.info(
        {
          query_hash: key,
          waiters: existing.waiters,
          is_dedupe_hit: true,
        },
        'Query deduplication hit - reusing existing execution'
      );
      return existing.promise;
    }

    // New query - execute and store
    const promise = executor();
    const lockEntry: LockEntry = {
      promise,
      timestamp: Date.now(),
      waiters: 0,
    };

    this.memoryLocks.set(key, lockEntry);

    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up lock after execution
      setTimeout(() => {
        this.memoryLocks.delete(key);
      }, SNOWFLAKE_CONFIG.LOCK_TTL_BUFFER);
    }
  }
}
```

### Memory Management

The in-memory lock manager automatically cleans up stale locks:

```typescript
private startCleanup(): void {
  this.cleanupInterval = setInterval(() => {
    const now = Date.now();
    const maxAge = SNOWFLAKE_CONFIG.DEFAULT_QUERY_TIMEOUT + SNOWFLAKE_CONFIG.LOCK_TTL_BUFFER;

    for (const [key, entry] of this.memoryLocks.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.memoryLocks.delete(key);
        serverLogger.info({ query_hash: key }, 'Cleaned up stale lock');
      }
    }
  }, SNOWFLAKE_CONFIG.LOCK_CLEANUP_INTERVAL);
}
```

### Lock Statistics

```typescript
public getStats(): LockStats {
  return {
    activeLocks: this.memoryLocks.size,
    totalHits: this.totalHits,
    totalMisses: this.totalMisses,
    deduplicationRate: this.totalHits + this.totalMisses > 0
      ? (this.totalHits / (this.totalHits + this.totalMisses)) * 100
      : 0,
  };
}
```

## 🛡️ Security Features

### SQL Injection Protection

The service uses multiple layers of protection against SQL injection:

#### 1. Parameterized Queries (Primary Defense)

```typescript
public async execute<T = any>(
  sqlText: string,
  binds?: (Bind | Date)[],
  options?: SnowflakeQueryOptions
): Promise<SnowflakeQueryResult<T>> {
  // Validate read-only
  this.validateReadOnlyQuery(sqlText);

  // Generate query hash for deduplication
  const queryHash = this.lockManager.hashQuery(sqlText, binds);

  // Execute with lock to prevent duplicate queries
  return this.lockManager.executeLocked(queryHash, async () => {
    const pool = await this.ensurePool();

    const result: any = await new Promise((resolve, reject) => {
      pool.use(async (connection: Connection) => {
        connection.execute({
          sqlText,
          binds: binds as any[], // ← Parameterized binds prevent injection
          fetchAsString: options?.fetchAsString,
          complete: (err: SnowflakeError | undefined, stmt: RowStatement, rows: any[] | undefined) => {
            if (err) {
              reject(err);
            } else {
              resolve({
                rows,
                metadata: stmt.getColumns(),
                statementHandle: stmt.getQueryId(),
              });
            }
          },
        });
      });
    });

    return result as SnowflakeQueryResult<T>;
  });
}
```

#### 2. Read-Only Validation (Secondary Defense)

The service validates queries are read-only by checking for write operations **anywhere** in the query, including inside CTEs (Common Table Expressions):

```typescript
/**
 * Validate that a query is read-only
 * Blocks INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, MERGE anywhere in query
 * This includes write operations inside CTEs (Common Table Expressions)
 */
private validateReadOnlyQuery(sqlText: string): void {
  const normalizedSql = sqlText.trim().toUpperCase();

  // Block write operations ANYWHERE in the query (including inside CTEs)
  // Using \b for word boundaries to avoid false positives in identifiers
  const writePatterns = [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+/i,
    /\bDELETE\s+FROM\b/i,
    /\bDROP\s+/i,
    /\bCREATE\s+/i,
    /\bALTER\s+/i,
    /\bTRUNCATE\s+/i,
    /\bMERGE\s+INTO\b/i,
    /\bGRANT\s+/i,
    /\bREVOKE\s+/i,
    /\bEXECUTE\s+/i,
    /\bCALL\s+/i,
  ];

  for (const pattern of writePatterns) {
    if (pattern.test(normalizedSql)) {
      serverLogger.error(
        {
          sql_preview: normalizedSql.substring(0, 100),
          matched_pattern: pattern.toString(),
        },
        'Blocked query with write operation (including CTEs)'
      );
      throw new Error('Only SELECT queries are allowed. Write operations detected.');
    }
  }

  // Ensure query starts with SELECT or WITH (for CTEs)
  if (!/^\s*SELECT\b/i.test(normalizedSql) && !/^\s*WITH\b/i.test(normalizedSql)) {
    throw new Error('Only SELECT queries are allowed');
  }
}
```

**Security Enhancement**: This validation prevents CTE-based bypass attempts like:

```sql
-- ❌ BLOCKED: Write operation inside CTE
WITH updated AS (
  UPDATE users SET active = false RETURNING *
)
SELECT * FROM updated;

-- ✅ ALLOWED: Read-only CTE
WITH user_stats AS (
  SELECT user_id, COUNT(*) as activity_count
  FROM activities
  GROUP BY user_id
)
SELECT * FROM user_stats WHERE activity_count > 10;
```

The validation uses word boundaries (`\b`) to avoid false positives while catching write operations anywhere in the query text.

#### 3. Database-Level Permissions (Tertiary Defense)

The Snowflake role used by the service should have SELECT-only permissions:

```sql
-- Snowflake DBA Setup
GRANT USAGE ON DATABASE analytics_db TO ROLE lfx_one_reader;
GRANT USAGE ON SCHEMA analytics_db.dbt TO ROLE lfx_one_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics_db.dbt TO ROLE lfx_one_reader;
GRANT SELECT ON FUTURE TABLES IN SCHEMA analytics_db.dbt TO ROLE lfx_one_reader;

-- Revoke any write permissions
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA analytics_db.dbt FROM ROLE lfx_one_reader;
```

### Private Key Authentication

The service uses JWT-based authentication with RSA key pairs:

#### Key Generation

```bash
# Generate private key
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out snowflake_rsa_key.p8 -nocrypt

# Generate public key
openssl rsa -in snowflake_rsa_key.p8 -pubout -out snowflake_rsa_key.pub

# Get public key fingerprint for Snowflake
openssl rsa -pubin -in snowflake_rsa_key.pub -outform DER | openssl dgst -sha256 -binary | openssl enc -base64
```

#### Snowflake Configuration

```sql
-- Add public key to Snowflake user
ALTER USER lfx_one_service_user SET RSA_PUBLIC_KEY='MIIBIjANBgk...';
```

#### Service Configuration

The service supports two authentication methods:

**Method 1: Direct API Key** (recommended for containers/Docker)

```typescript
// Set in environment variable
SNOWFLAKE_API_KEY = your - private - key - here;
```

**Method 2: File-based** (recommended for local development)

```typescript
// Place rsa_key.p8 file in app root directory (apps/lfx-one/)
// Service automatically looks for it at: path.join(__dirname, '../../../rsa_key.p8')
// Optional passphrase can be set via:
SNOWFLAKE_PRIVATE_KEY_PASSPHRASE = your_passphrase;
```

## ⚙️ Configuration

### Environment Variables

```bash
############### SNOWFLAKE CONFIG ###############
# Snowflake Connection Configuration
# Account identifier in format: orgname-accountname
SNOWFLAKE_ACCOUNT=jnmhvwd-xpb85243
SNOWFLAKE_USERNAME=DEV_ADESILVA
SNOWFLAKE_WAREHOUSE=LF_DEVELOPMENT_WH
SNOWFLAKE_DATABASE=ANALYTICS
SNOWFLAKE_ROLE=LF_DEVELOPER_R_ROLE

# Snowflake Authentication (choose one method)
# Method 1: Direct API Key (recommended for containers/Docker)
# SNOWFLAKE_API_KEY=your-private-key-here

# Method 2: Private Key File (recommended for local development)
# Place rsa_key.p8 file in app root directory (same location as .env)
# The service will automatically detect and use it
# SNOWFLAKE_PRIVATE_KEY_PASSPHRASE=your-passphrase-here

# Optional: Connection Pool Configuration (defaults shown)
# SNOWFLAKE_MIN_CONNECTIONS=2
# SNOWFLAKE_MAX_CONNECTIONS=10

# Optional: Lock Strategy for Query Deduplication (defaults to 'memory')
# SNOWFLAKE_LOCK_STRATEGY=memory
############### END SNOWFLAKE CONFIG ###############

# Redis (future - for distributed locking)
# REDIS_URL=redis://localhost:6379
```

**Example values shown above are for development environment. For production:**

- Use production account identifier
- Configure appropriate warehouse size
- Use production-specific role with audited permissions
- Store private keys in secure secrets management (Kubernetes Secrets, AWS Secrets Manager, etc.)

### Configuration Constants

```typescript
// packages/shared/src/constants/snowflake.constant.ts
export const SNOWFLAKE_CONFIG = {
  // Timeouts
  DEFAULT_QUERY_TIMEOUT: 60000, // 60 seconds
  CONNECTION_TIMEOUT: 30000, // 30 seconds

  // Pool configuration
  MIN_CONNECTIONS: 2,
  MAX_CONNECTIONS: 10,

  // Lock management
  LOCK_CLEANUP_INTERVAL: 60000, // 60 seconds
  LOCK_TTL_BUFFER: 5000, // 5 seconds

  // Retry
  MAX_RETRIES: 3,
} as const;
```

## 📦 TypeScript Interfaces

### Core Interfaces

```typescript
// packages/shared/src/interfaces/snowflake.interface.ts
import type { Column, DataType } from 'snowflake-sdk';

export interface SnowflakeQueryResult<T> {
  rows: T[];
  metadata: Column[]; // Using SDK's Column type
  statementHandle?: string;
}

export interface SnowflakeQueryOptions {
  timeout?: number;
  fetchAsString?: DataType[]; // SDK's DataType enum for type conversion
}

export interface SnowflakePoolStats {
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  totalConnections: number;
}

export interface LockStats {
  activeLocks: number;
  totalHits: number;
  totalMisses: number;
  deduplicationRate: number; // Percentage
}

interface LockEntry {
  promise: Promise<any>;
  timestamp: number;
  waiters: number;
}
```

### Enums

```typescript
// packages/shared/src/enums/snowflake.enum.ts

export enum SnowflakeLockStrategy {
  MEMORY = 'memory',
  REDIS = 'redis',
}
```

## 🔗 Service Integration

### Using the Snowflake Service

The `SnowflakeService` provides a simple, secure interface for executing read-only analytical queries:

```typescript
import { SnowflakeService } from '../services/snowflake.service';
import type { Bind } from 'snowflake-sdk';

export class AnalyticsController {
  private snowflakeService: SnowflakeService | null = null;

  /**
   * Lazy initialization of SnowflakeService
   */
  private getSnowflakeService(): SnowflakeService {
    if (!this.snowflakeService) {
      this.snowflakeService = new SnowflakeService();
    }
    return this.snowflakeService;
  }

  /**
   * Example: Query user activity data
   */
  async getUserActivity(userEmail: string, startDate: Date) {
    // Execute parameterized query with automatic connection pooling and deduplication
    const result = await this.getSnowflakeService().execute<ActivityRow>(
      `SELECT
        activity_date,
        activity_count
      FROM analytics_db.user_activity
      WHERE email = ?
        AND activity_date >= ?
      ORDER BY activity_date ASC`,
      [userEmail, startDate] // Date objects are automatically normalized
    );

    return result.rows;
  }
}
```

### Best Practices for Callers

1. **Lazy Initialization**: Create `SnowflakeService` instances on-demand to avoid startup overhead
2. **Parameterized Queries**: Always use `?` placeholders with bind parameters - never concatenate user input
3. **Date Handling**: Pass `Date` objects directly as bind parameters - they're automatically converted to ISO strings
4. **Type Safety**: Define TypeScript interfaces for query result rows
5. **Error Handling**: Catch and handle Snowflake-specific errors appropriately
6. **Query Optimization**: Use specific column selection, appropriate WHERE clauses, and leverage Snowflake features

### Example with Advanced Features

```typescript
async getAggregatedMetrics(filters: MetricFilters) {
  const binds: (Bind | Date)[] = [filters.startDate, filters.endDate];

  // Build dynamic query with parameterized filters
  let sql = `
    SELECT
      DATE_TRUNC('day', recorded_at) as date,
      COUNT(*) as event_count,
      SUM(metric_value) as total_value
    FROM analytics_events
    WHERE recorded_at BETWEEN ? AND ?
  `;

  // Add optional filters with proper parameterization
  if (filters.projectIds?.length) {
    sql += ` AND project_id IN (${filters.projectIds.map(() => '?').join(',')})`;
    binds.push(...filters.projectIds);
  }

  sql += " GROUP BY DATE_TRUNC('day', recorded_at) ORDER BY date";

  // Execute with type-safe result
  const result = await this.getSnowflakeService().execute<AggregatedMetric>(sql, binds);

  return result.rows;
}
```

### Service Lifecycle Management

```typescript
// Graceful shutdown on application termination
async shutdown(): Promise<void> {
  if (this.snowflakeService) {
    await this.snowflakeService.shutdown();
  }
}
```

## 📊 Monitoring and Logging

### Structured Logging

```typescript
// Query execution logging
serverLogger.info(
  {
    query_hash: 'abc123...',
    is_dedupe_hit: false,
    pool_active: 5,
    pool_idle: 3,
    pool_waiting: 0,
    execution_time_ms: 1234,
    row_count: 150,
  },
  'Snowflake query executed successfully'
);

// Deduplication hit
serverLogger.info(
  {
    query_hash: 'def456...',
    is_dedupe_hit: true,
    waiters: 3,
    saved_queries: 3,
  },
  'Query deduplication hit - reused existing execution'
);

// Pool exhaustion warning
serverLogger.warn(
  {
    pool_active: 10,
    pool_idle: 0,
    pool_waiting: 5,
    pool_utilization: 100,
  },
  'Snowflake pool exhausted - consider increasing max connections'
);
```

### Key Metrics

Track these metrics for operational visibility:

- **Query Performance**:
  - Average query execution time
  - P95/P99 query latency
  - Slow query count (>5s)

- **Pool Utilization**:
  - Active connections / Max connections (%)
  - Average idle connections
  - Pool exhaustion events
  - Connection acquire wait time

- **Deduplication Effectiveness**:
  - Deduplication hit rate (%)
  - Average waiters per deduplicated query
  - Queries saved per minute
  - Active locks count

- **Error Rates**:
  - Query failures (%)
  - Connection failures (%)
  - Timeout errors
  - Authentication failures

### Health Check Integration

```typescript
// Add to server health endpoint
app.get('/health', (req, res) => {
  const snowflakeStats = snowflakeService.getPoolStats();
  const lockStats = snowflakeService.getLockStats();

  const healthStatus = {
    snowflake: {
      connected: snowflakeService.isConnected(),
      pool: {
        active: snowflakeStats.activeConnections,
        idle: snowflakeStats.idleConnections,
        waiting: snowflakeStats.waitingRequests,
        total: snowflakeStats.totalConnections,
        utilization: (snowflakeStats.activeConnections / snowflakeStats.totalConnections) * 100,
      },
      locks: {
        active: lockStats.activeLocks,
        deduplication_rate: lockStats.deduplicationRate,
      },
    },
  };

  res.json(healthStatus);
});
```

## 🔧 Development and Troubleshooting

### Local Development Setup

For local development, ensure you have:

1. **Private Key File**: Store securely outside repository
2. **Environment Variables**: Configure in `.env` file
3. **Snowflake Access**: Verify role has SELECT permissions

```bash
# .env (development example)
SNOWFLAKE_ACCOUNT=jnmhvwd-xpb85243
SNOWFLAKE_USERNAME=DEV_ADESILVA
SNOWFLAKE_WAREHOUSE=LF_DEVELOPMENT_WH
SNOWFLAKE_DATABASE=ANALYTICS
SNOWFLAKE_ROLE=LF_DEVELOPER_R_ROLE

# Authentication Method 1: Direct API Key (recommended for containers)
SNOWFLAKE_API_KEY=your-private-key-here

# Authentication Method 2: Private Key File (recommended for local development)
# Place rsa_key.p8 file in app root directory (same location as .env)
# The service will automatically detect and use it
# SNOWFLAKE_PRIVATE_KEY_PASSPHRASE=your_passphrase

# Optional: Override default pool settings
# SNOWFLAKE_MIN_CONNECTIONS=2
# SNOWFLAKE_MAX_CONNECTIONS=5
```

**Note**: The example values above are for the development environment. Copy `.env.example` to `.env` and update with your actual credentials.

### Common Issues and Solutions

#### 1. Authentication Failures

```text
Error: JWT token verification failed
Cause: Invalid private key or public key not registered in Snowflake
Solution:
  1. Verify private key file exists and is readable
  2. Check public key is correctly added to Snowflake user
  3. Ensure key fingerprint matches
```

#### 2. Pool Exhaustion

```text
Error: Timeout acquiring connection from pool
Cause: All connections busy, max pool size reached
Solution:
  1. Increase SNOWFLAKE_MAX_CONNECTIONS
  2. Optimize slow queries
  3. Implement query result caching
  4. Check for connection leaks (unreleased connections)
```

#### 3. Query Timeout

```text
Error: Query execution timeout
Cause: Query taking longer than configured timeout
Solution:
  1. Optimize query with indexes/partitions
  2. Increase SNOWFLAKE_CONFIG.DEFAULT_QUERY_TIMEOUT
  3. Consider breaking into smaller queries
  4. Check Snowflake warehouse size
```

#### 4. Read-Only Validation Failure

```text
Error: Only SELECT queries are allowed
Cause: Attempted to execute write operation
Solution:
  1. Verify query is a SELECT statement
  2. Check for CTEs or subqueries with writes
  3. Review application logic for query construction
```

### Debugging Commands

```bash
# Test Snowflake connection
snowsql -a your_account \
  -u lfx_one_service_user \
  --private-key-path /path/to/key.p8 \
  -w compute_wh \
  -d analytics_db \
  -s dbt

# Check user permissions
SHOW GRANTS TO ROLE lfx_one_reader;

# Monitor warehouse usage
SELECT *
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE USER_NAME = 'LFX_ONE_SERVICE_USER'
  AND START_TIME >= DATEADD(hour, -1, CURRENT_TIMESTAMP())
ORDER BY START_TIME DESC;

# Check connection pool stats
curl http://localhost:4000/health | jq '.snowflake.pool'
```

## 🎯 Best Practices

### Performance Optimization

1. **Query Design**:
   - Use specific column selection instead of `SELECT *`
   - Add appropriate WHERE clauses to limit data scanned
   - Leverage Snowflake clustering keys for large tables
   - Use result_scan() for repeated access to same result

2. **Connection Management**:
   - Monitor pool utilization and adjust sizing
   - Release connections promptly in finally blocks
   - Use connection pooling for all queries
   - Avoid long-running transactions

3. **Deduplication Strategy**:
   - Enable for frequently-requested data
   - Monitor hit rate and adjust as needed
   - Consider result caching for extremely hot queries
   - Use appropriate TTL based on data freshness requirements

4. **Warehouse Sizing**:
   - Start with smaller warehouse, scale as needed
   - Use auto-suspend and auto-resume
   - Consider dedicated warehouse for service queries
   - Monitor query queue time

### Security Best Practices

1. **Key Management**:
   - Never commit private keys to repository
   - Use Kubernetes secrets for production
   - Rotate keys regularly (every 90 days)
   - Restrict file permissions (chmod 600)

2. **Role Permissions**:
   - Grant minimum required permissions (SELECT only)
   - Use separate roles for different services
   - Audit permissions regularly
   - Enable Snowflake session policies

3. **Query Validation**:
   - Always use parameterized queries
   - Never concatenate user input into SQL
   - Validate input data types
   - Log all query attempts with context

### Code Quality

1. **Type Safety**:
   - Use TypeScript interfaces for query results
   - Define result types explicitly
   - Leverage SDK's `Bind` type for parameters (accepts `Bind | Date`)
   - Use const assertions for configuration

2. **Error Handling**:
   - Catch and log all errors with context
   - Provide meaningful error messages
   - Implement retry logic for transient failures
   - Use try-finally for resource cleanup

3. **Testing**:
   - Mock SnowflakeService for unit tests
   - Use test database for integration tests
   - Test SQL injection protection
   - Verify read-only enforcement
   - Load test connection pool behavior

## 🔮 Future Enhancements

### Redis Distributed Locking

When scaling to multiple service instances, migrate to Redis-based locking:

#### Architecture

```text
Service Instance 1 ──┐
Service Instance 2 ──┼──> Redis ──> Distributed Lock ──> Snowflake
Service Instance 3 ──┘
```

#### Implementation

```typescript
// Future: lock-manager.ts with Redis strategy
private async executeLockedRedis<T>(
  key: string,
  executor: () => Promise<T>
): Promise<T> {
  const lockKey = `snowflake:query:${key}`;
  const lockValue = uuidv4();
  const ttl = SNOWFLAKE_CONFIG.DEFAULT_QUERY_TIMEOUT + SNOWFLAKE_CONFIG.LOCK_TTL_BUFFER;

  // Try to acquire lock
  const acquired = await this.redisClient.set(lockKey, lockValue, 'NX', 'PX', ttl);

  if (!acquired) {
    // Lock held by another instance - wait and poll
    return this.waitForLock(lockKey, executor);
  }

  try {
    const result = await executor();
    return result;
  } finally {
    // Release lock if we still own it
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.redisClient.eval(script, 1, lockKey, lockValue);
  }
}
```

#### Migration Path

1. Add `ioredis` dependency
2. Implement `RedisLockManager` strategy in `lock-manager.ts`
3. Configure `REDIS_URL` and `SNOWFLAKE_LOCK_STRATEGY=redis`
4. Deploy with zero downtime (both strategies supported)
5. Monitor deduplication effectiveness across instances

### Query Result Caching

Future enhancement to cache query results in Redis:

```typescript
async execute<T>(sql: string, binds?: (Bind | Date)[]): Promise<T> {
  const cacheKey = this.generateCacheKey(sql, binds);

  // Check cache
  const cached = await this.cache.get<T>(cacheKey);
  if (cached) return cached;

  // Execute with deduplication
  const result = await this.executeLocked(sql, binds);

  // Store in cache
  await this.cache.set(cacheKey, result, { ttl: 300 }); // 5 min TTL

  return result;
}
```

## 📈 Performance Metrics

### Benchmark Results

Expected performance characteristics (varies by query complexity):

- **Simple queries** (<1000 rows): 100-500ms
- **Complex aggregations**: 1-5 seconds
- **Large result sets** (>10K rows): 5-30 seconds
- **Pool acquisition**: <10ms (when connections available)
- **Deduplication overhead**: <1ms (hash computation)

### Resource Utilization

Typical resource usage per service instance:

- **Memory**: 50-100MB baseline + ~1MB per 1000 active locks
- **CPU**: Minimal (<5%) for query management, dependent on Snowflake for execution
- **Network**: Dependent on result set size, typically <10MB/s
- **Connections**: 2-10 concurrent connections to Snowflake

## 🔗 Related Documentation

- [Backend Architecture Overview](./README.md)
- [NATS Integration](./nats-integration.md)
- [Authentication & Authorization](./authentication.md)
- [Environment Configuration](../../CLAUDE.md#environment-configuration)

## 📚 External Resources

- [Snowflake Node.js Driver Documentation](https://docs.snowflake.com/en/user-guide/nodejs-driver)
- [Snowflake Key Pair Authentication](https://docs.snowflake.com/en/user-guide/key-pair-auth)
- [Snowflake Query Performance Optimization](https://docs.snowflake.com/en/user-guide/ui-snowsight-query-profile)
- [Connection Pooling Best Practices](https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-use#using-connection-pools)
- [Redis Distributed Locks](https://redis.io/docs/manual/patterns/distributed-locks/)
