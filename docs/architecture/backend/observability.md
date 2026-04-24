# Observability (Tracing & Metrics)

The LFX One backend ships with OpenTelemetry-based distributed tracing that activates only when an OTLP endpoint is configured. Tracing is **off by default** in dev and activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (no reachability probe — the bootstrap only checks the env var). Traces correlate with structured Pino logs via request IDs and W3C trace context headers.

## Components

| File / module                              | Responsibility                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `apps/lfx-one/otel.mjs`                    | Bootstraps the NodeSDK, registers instrumentations, picks the sampler        |
| `apps/lfx-one/src/server/server-tracer.ts` | Exports `SERVICE_NAME` and a named `tracer` for custom spans inside services |
| `apps/lfx-one/src/server/server.ts`        | Uses `pinoHttp` middleware; HTTP/Express spans are auto-instrumented         |

### `otel.mjs` (bootstrap)

`otel.mjs` is loaded before the Express app starts so auto-instrumentation can patch the HTTP and Express modules on import. It reads configuration from environment variables and registers the NodeSDK only if an OTLP endpoint is present.

### `server-tracer.ts`

```typescript
// apps/lfx-one/src/server/server-tracer.ts
export const SERVICE_NAME = process.env['OTEL_SERVICE_NAME'] || 'lfx-v2-ui';
export const tracer = trace.getTracer(SERVICE_NAME);
```

The `SERVICE_NAME` constant is also consumed by `server-logger.ts` so log entries and spans share the same service identifier. Import `tracer` from here when you need to create custom spans inside a service — do not call `trace.getTracer(...)` ad-hoc.

## Configuration

| Env var                       | Default                                          | Purpose                                                                                                         |
| ----------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(unset → tracing off)_                          | Required to turn tracing on. Points at the OTLP collector (HTTP or gRPC).                                       |
| `OTEL_SERVICE_NAME`           | `lfx-v2-ui`                                      | Identifier that appears on every span and in log metadata.                                                      |
| `APP_VERSION`                 | `development` (otel.mjs) / `1.0.0` (pino logger) | Tagged onto the `service.version` resource attribute (otel.mjs) and the log `version` field (server-logger.ts). |
| `NODE_ENV`                    | `development`                                    | Drives `deployment.environment` resource attribute (`dev`, `stage`, `prod`).                                    |
| `OTEL_LOG_LEVEL`              | `info`                                           | Passed through to the OTel SDK diagnostics logger.                                                              |
| `OTEL_TRACES_SAMPLER`         | `parentbased_always_on`                          | One of `always_on`, `always_off`, `traceidratio`, `parentbased_*`.                                              |
| `OTEL_TRACES_SAMPLER_ARG`     | —                                                | Ratio argument for the `*_traceidratio` samplers.                                                               |

Tracing activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — leaving it unset keeps the SDK out of the process entirely (no overhead in dev).

## What gets instrumented

- **HTTP** (`HttpInstrumentation`) — incoming and outgoing HTTP requests, with `/health`, `/api/health`, and `/.well-known/*` excluded so health checks don't flood spans.
- **Express** (`ExpressInstrumentation`) — per-middleware spans so you can see which middleware runs for a given request.
- **Undici** (`UndiciInstrumentation`) — spans for `fetch` / `undici` calls (used by `api-client.service.ts` for microservice calls). Content-type headers are captured.
- **Propagators** — W3C Trace Context + W3C Baggage (`traceparent`, `tracestate`, `baggage` headers) so spans correlate across the NATS boundary and into downstream microservices.

## Correlation with logs

Pino's HTTP middleware (`pinoHttp` in `server.ts`) attaches a request-scoped logger that includes the OTel `trace_id` and `span_id` in every log entry. That means a CloudWatch log filtered on a trace ID will surface every log line produced by the same request, across every service hop.

## Custom spans

If a service method warrants its own span (slow external call, complex business logic), import the shared `tracer` and wrap the work:

```typescript
import { tracer } from '../server-tracer';

public async runQuery(req: Request, sql: string): Promise<Result> {
  return tracer.startActiveSpan('snowflake.runQuery', async (span) => {
    try {
      const result = await this.pool.execute(sql);
      span.setAttribute('snowflake.rows', result.rowCount);
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

Use custom spans sparingly. Auto-instrumentation covers 90% of the interesting work; hand-rolled spans are worth adding only when you need attributes the auto-instrumentation can't see (row counts, cache hit/miss, retry counts, etc.).

## Related

- [Logging & Monitoring](logging-monitoring.md) — Pino logger service, request correlation, log levels.
- [SSR Server](ssr-server.md) — middleware order, where `pinoHttp` sits in the pipeline.
