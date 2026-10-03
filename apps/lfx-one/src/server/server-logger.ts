// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// A deep import: the utils barrel reaches Angular, which specs that load the logger do not compile.
import { redactInviteToken } from '@lfx-one/shared/utils/auth-fragment.utils';
import { trace } from '@opentelemetry/api';
import { IncomingMessage, ServerResponse } from 'node:http';

import pino from 'pino';
import pinoPretty from 'pino-pretty';

import { customErrorSerializer, readLogField, scrubLogRecord } from './helpers/error-serializer';
import { SERVICE_NAME } from './server-tracer';

/**
 * Whitelist-based request serializer.
 * Only emits known-safe fields — prevents accidental leakage of
 * authorization headers, cookies, API keys, or other sensitive data.
 */
export function reqSerializer(req: IncomingMessage & { id?: string; originalUrl?: string; ip?: string }) {
  return {
    id: req.id,
    method: req.method,
    // The invite pages carry a signed credential in `?token=`; only the base matters for parsing a relative URL.
    url: redactInviteToken(req.originalUrl || req.url || '', 'http://localhost'),
    remoteAddress: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
  };
}

/**
 * Whitelist-based response serializer.
 * Only emits statusCode — prevents leakage of set-cookie or other sensitive response headers.
 */
export function resSerializer(res: ServerResponse) {
  return {
    statusCode: res.statusCode,
  };
}

/**
 * Deep-scrubs every log field, under one node budget per call, except the ones a serializer owns —
 * `err`/`error` run `customErrorSerializer`, which applies the same scrub under its own budget, and
 * must still receive the raw Error so its type/message/stack survive; `req`/`res` serializers are
 * allowlists already. Each top-level read is guarded too, so a throwing getter is logged as
 * `[Unserializable]` instead of escaping the logger.
 */
function scrubLogFields(object: Record<string, unknown>): Record<string, unknown> {
  return scrubLogRecord(object, ['err', 'error', 'req', 'res']);
}

/**
 * pino merges the mixin into the log object with `Object.assign` before `formatters.log` runs, which
 * would invoke a throwing getter unguarded. Same merge (call fields win over mixin fields), guarded reads.
 */
function mergeMixin(object: object, mixinData: object): object {
  const merged = mixinData as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    merged[key] = readLogField(object, key);
  }
  return merged;
}

/**
 * Base Pino logger instance for server-level operations.
 *
 * Used for:
 * - Server startup/shutdown messages
 * - Direct logging from server code outside request context
 * - Operations that don't have access to req.log
 * - Infrastructure operations (NATS, Snowflake, etc.)
 */

// Create pretty stream conditionally for development
const prettyStream =
  process.env['NODE_ENV'] !== 'production'
    ? pinoPretty({
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      })
    : process.stdout;

export const serverLogger = pino(
  {
    level: process.env['LOG_LEVEL'] || 'info',
    base: {
      service: SERVICE_NAME,
      environment: process.env['NODE_ENV'] || 'development',
      version: process.env['APP_VERSION'] || '1.0.0',
    },
    mixin: () => {
      const mixinData: Record<string, unknown> = {};

      const traceHeader = process.env['_X_AMZN_TRACE_ID'];
      if (traceHeader) {
        mixinData['aws_trace_id'] = traceHeader.split(';')[0]?.replace('Root=', '');
      }

      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        const spanContext = activeSpan.spanContext();
        mixinData['trace_id'] = spanContext.traceId;
        mixinData['span_id'] = spanContext.spanId;
        mixinData['trace_flags'] = spanContext.traceFlags;
      }

      return mixinData;
    },
    mixinMergeStrategy: mergeMixin,
    serializers: {
      err: customErrorSerializer,
      error: customErrorSerializer,
      req: reqSerializer,
      res: resSerializer,
    },
    // Exact-path backstop; nested credentials are handled by `formatters.log` / the err serializer below.
    redact: {
      paths: ['access_token', 'refresh_token', 'id_token', 'authorization', 'cookie', 'err.command.args', 'error.command.args'],
      remove: true,
    },
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
      // `redact.paths` only matches exact paths, so a token nested under `data` (or anywhere else)
      // would slip through. Deep-scrub every field instead (see `scrubLogFields`).
      log: scrubLogFields,
      bindings: (bindings) => ({
        pid: bindings['pid'],
        hostname: bindings['hostname'],
      }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  prettyStream
);

// pino serializes `child()` bindings once, when the child is created, through neither
// `formatters.log` nor (for children) `formatters.bindings` — scrub them here. Every child is an
// `Object.create` of its parent, so children (pino-http's `req.log` included) inherit this override.
const createChild = serverLogger.child;
serverLogger.child = function (this: typeof serverLogger, bindings, options) {
  return createChild.call(this, scrubLogFields(bindings), options);
} as typeof serverLogger.child;
