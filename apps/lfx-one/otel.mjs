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

const { diag, DiagConsoleLogger, DiagLogLevel } = otelApi;
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

if (!otlpEndpoint) {
  console.log('[otel] OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled');
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
  if (diagLevelMap[logLevel] !== undefined) {
    diag.setLogger(new DiagConsoleLogger(), diagLevelMap[logLevel]);
  } else {
    console.warn(`[otel] Unknown OTEL_LOG_LEVEL: ${logLevel}, defaulting to info`);
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const serviceName = process.env['OTEL_SERVICE_NAME'] || 'lfx-v2-ui';
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
    console.warn(`[otel] Invalid OTEL_TRACES_SAMPLER_ARG=${process.env['OTEL_TRACES_SAMPLER_ARG']}, using ${traceRatio}`);
  }

  // OTEL_TRACES_SAMPLER selects the sampler strategy (default: parentbased_always_on)
  const samplerName = (process.env['OTEL_TRACES_SAMPLER'] || 'parentbased_always_on').toLowerCase();
  const knownSamplers = ['always_on', 'always_off', 'traceidratio', 'parentbased_always_on', 'parentbased_always_off', 'parentbased_traceidratio'];
  if (!knownSamplers.includes(samplerName)) {
    console.warn(`[otel] Unknown sampler: ${samplerName}, falling back to parentbased_always_on`);
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
          return url === '/health' || url === '/api/health' || url.startsWith('/.well-known');
        },
      }),
      new ExpressInstrumentation(),
      new UndiciInstrumentation({
        headersToSpanAttributes: {
          requestHeaders: ['content-type'],
          responseHeaders: ['content-type'],
        },
      }),
    ],
  });

  try {
    await sdk.start();
    console.log('[otel] Tracing enabled:', JSON.stringify({
      service: serviceName,
      version: serviceVersion,
      sampler: samplerName,
      ratio: traceRatio,
    }));
  } catch (err) {
    console.error('[otel] Failed to start SDK:', err);
  }

  const shutdown = async () => {
    try {
      await sdk.shutdown();
      console.log('[otel] SDK shut down successfully');
    } catch (err) {
      console.error('[otel] Error shutting down SDK:', err);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
