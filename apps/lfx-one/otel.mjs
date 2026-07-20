// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import otelApi from '@opentelemetry/api';
import otelExporterProto from '@opentelemetry/exporter-trace-otlp-proto';
import otelExpress from '@opentelemetry/instrumentation-express';
import otelHttp from '@opentelemetry/instrumentation-http';
import otelUndici from '@opentelemetry/instrumentation-undici';
import otelSdk from '@opentelemetry/sdk-node';
import otelSemconv from '@opentelemetry/semantic-conventions';
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating';

const { diag, DiagLogLevel } = otelApi;
const { OTLPTraceExporter: OTLPTraceExporterProto } = otelExporterProto;
const { ExpressInstrumentation } = otelExpress;
const { HttpInstrumentation } = otelHttp;
const { UndiciInstrumentation } = otelUndici;
const { NodeSDK, resources, core, tracing } = otelSdk;
const { resourceFromAttributes } = resources;
const { CompositePropagator, W3CTraceContextPropagator, W3CBaggagePropagator } = core;
const { AlwaysOnSampler, AlwaysOffSampler, TraceIdRatioBasedSampler, ParentBasedSampler } = tracing;
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = otelSemconv;

const otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

// Minimal JSON logger for otel.mjs — serverLogger is not available here since
// this module runs via --import before the server module loads.
// JSON.stringify is wrapped in try/catch so non-serializable values (bigint,
// circular structures) never crash the process; falls back to a minimal line.
// The replacer normalizes Error instances so their message and stack are
// captured — by default JSON.stringify serializes Error as {}.
function otelReplacer(_key, value) {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack, name: value.name };
  }
  return value;
}
function otelWrite(level, msg, extra) {
  try {
    process.stdout.write(JSON.stringify({ level, msg, ...extra }, otelReplacer) + '\n');
  } catch {
    try {
      process.stdout.write(JSON.stringify({ level, msg }) + '\n');
    } catch {
      // stdout closed (e.g. EPIPE) — drop the line; never crash the boot path.
    }
  }
}
const otelLog = {
  info: (msg, extra) => otelWrite('INFO', msg, extra),
  warn: (msg, extra) => otelWrite('WARN', msg, extra),
  error: (msg, extra) => otelWrite('ERROR', msg, extra),
  debug: (msg, extra) => otelWrite('DEBUG', msg, extra),
};

if (!otlpEndpoint) {
  otelLog.info('[otel] OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled');
} else {
  const logLevel = (process.env['OTEL_LOG_LEVEL'] || 'info').toLowerCase();
  const diagLevelMap = {
    none: DiagLogLevel.NONE,
    error: DiagLogLevel.ERROR,
    warn: DiagLogLevel.WARN,
    info: DiagLogLevel.INFO,
    debug: DiagLogLevel.DEBUG,
    verbose: DiagLogLevel.VERBOSE,
    all: DiagLogLevel.ALL,
  };

  // Custom JSON diag logger so OTel diagnostic output stays single-line JSON.
  const jsonDiagLogger = {
    error: (msg, ...args) => otelLog.error(`[otel] ${msg}`, args.length ? { args } : undefined),
    warn: (msg, ...args) => otelLog.warn(`[otel] ${msg}`, args.length ? { args } : undefined),
    info: (msg, ...args) => otelLog.info(`[otel] ${msg}`, args.length ? { args } : undefined),
    debug: (msg, ...args) => otelLog.debug(`[otel] ${msg}`, args.length ? { args } : undefined),
    verbose: (msg, ...args) => otelLog.debug(`[otel] ${msg}`, args.length ? { args } : undefined),
  };
  if (diagLevelMap[logLevel] !== undefined) {
    diag.setLogger(jsonDiagLogger, diagLevelMap[logLevel]);
  } else {
    otelLog.warn(`[otel] Unknown OTEL_LOG_LEVEL: ${logLevel}, defaulting to info`);
    diag.setLogger(jsonDiagLogger, DiagLogLevel.INFO);
  }

  const serviceName = process.env['OTEL_SERVICE_NAME'] || 'lfx-self-serve';
  const serviceVersion = process.env['APP_VERSION'] || 'development';

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: ({ dev: 'development', stage: 'staging', prod: 'production' })[process.env['NODE_ENV']] ?? (process.env['NODE_ENV'] || 'development'),
  });

  const traceExporter = new OTLPTraceExporterProto({ url: `${otlpEndpoint}/v1/traces` });

  // Trace sampling ratio (0.0 to 1.0, default 1.0 = sample everything)
  const rawRatio = parseFloat(process.env['OTEL_TRACES_SAMPLER_ARG'] || '1.0');
  const traceRatio = Number.isFinite(rawRatio) ? Math.min(1.0, Math.max(0.0, rawRatio)) : 1.0;
  if (process.env['OTEL_TRACES_SAMPLER_ARG'] && (!Number.isFinite(rawRatio) || rawRatio < 0 || rawRatio > 1)) {
    otelLog.warn(`[otel] Invalid OTEL_TRACES_SAMPLER_ARG=${process.env['OTEL_TRACES_SAMPLER_ARG']}, using ${traceRatio}`);
  }

  // OTEL_TRACES_SAMPLER selects the sampler strategy (default: parentbased_always_on)
  const samplerName = (process.env['OTEL_TRACES_SAMPLER'] || 'parentbased_always_on').toLowerCase();
  const knownSamplers = ['always_on', 'always_off', 'traceidratio', 'parentbased_always_on', 'parentbased_always_off', 'parentbased_traceidratio'];
  if (!knownSamplers.includes(samplerName)) {
    otelLog.warn(`[otel] Unknown sampler: ${samplerName}, falling back to parentbased_always_on`);
  }
  let sampler;
  switch (samplerName) {
    case 'always_on':
      sampler = new AlwaysOnSampler();
      break;
    case 'always_off':
      sampler = new AlwaysOffSampler();
      break;
    case 'traceidratio':
      sampler = new TraceIdRatioBasedSampler(traceRatio);
      break;
    case 'parentbased_always_on':
      sampler = new ParentBasedSampler({ root: new AlwaysOnSampler() });
      break;
    case 'parentbased_always_off':
      sampler = new ParentBasedSampler({ root: new AlwaysOffSampler() });
      break;
    case 'parentbased_traceidratio':
      sampler = new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(traceRatio) });
      break;
    default:
      sampler = new ParentBasedSampler({ root: new AlwaysOnSampler() });
      break;
  }

  const textMapPropagator = new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    sampler,
    textMapPropagator,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url || '';
          return url === '/livez' || url === '/readyz' || url.startsWith('/.well-known');
        },
        applyCustomAttributesOnSpan: (span, request, response) => {
          const req = 'req' in response ? response.req : undefined;
          if (!req) return;

          const routePath = req.route?.path;
          // Skip pure wildcard route paths ('**', '*', '/*', '/**') leaked from
          // static-asset fallthrough — they collapse SSR traffic into a single bucket.
          const isWildcardOnly = typeof routePath === 'string' && /^\/?\*+$/.test(routePath);

          if (routePath && !isWildcardOnly) {
            const baseUrl = req.baseUrl || '';
            let fullRoute = `${baseUrl}${routePath}`;
            // Strip trailing slash from mounted router root (e.g. `/api/meetings/` → `/api/meetings`).
            if (fullRoute.length > 1 && fullRoute.endsWith('/')) {
              fullRoute = fullRoute.slice(0, -1);
            }
            span.setAttribute('http.route', fullRoute);
            span.updateName(`${request.method} ${fullRoute}`);
            return;
          }

          const url = (req.originalUrl || req.url || '').split('?')[0];
          const segments = url.split('/').filter(Boolean);
          let bucket;
          if (segments.length === 0) {
            bucket = '/';
          } else if (segments.length === 1) {
            // Single-segment URLs (e.g. `/login`) are concrete endpoints, not prefixes.
            bucket = `/${segments[0]}`;
          } else {
            bucket = `/${segments[0]}/*`;
          }
          span.setAttribute('http.route', bucket);
          span.updateName(`${request.method} ${bucket}`);
        },
      }),
      new ExpressInstrumentation(),
      new UndiciInstrumentation({
        headersToSpanAttributes: {
          requestHeaders: ['content-type'],
          responseHeaders: ['content-type'],
        },
        responseHook: (span, { request, response }) => {
          if (response.statusCode >= 500) {
            const path = request.path.split('?')[0];
            const err = new Error(
              `HTTP ${response.statusCode} ${request.method} ${request.origin}${path}`
            );
            err.name = 'HttpClientError';
            span.recordException(err);
          }
        },
      }),
    ],
  });

  try {
    await sdk.start();
    otelLog.info('[otel] Tracing enabled', { service: serviceName, version: serviceVersion, sampler: samplerName, ratio: traceRatio });
  } catch (err) {
    otelLog.error('[otel] Failed to start SDK', { err: err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) } });
  }

  const shutdown = async () => {
    try {
      await sdk.shutdown();
      otelLog.info('[otel] SDK shut down successfully');
    } catch (err) {
      otelLog.error('[otel] Error shutting down SDK', { err: err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) } });
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
