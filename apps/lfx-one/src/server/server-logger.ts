// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IncomingMessage, ServerResponse } from 'node:http';

import pino from 'pino';
import pinoPretty from 'pino-pretty';

import { customErrorSerializer } from './helpers/error-serializer';

/**
 * Whitelist-based request serializer.
 * Only emits known-safe fields — prevents accidental leakage of
 * authorization headers, cookies, API keys, or other sensitive data.
 */
export function reqSerializer(req: IncomingMessage & { id?: string; originalUrl?: string; ip?: string }) {
  return {
    id: req.id,
    method: req.method,
    url: req.originalUrl || req.url,
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
      service: 'lfx-one-ssr',
      environment: process.env['NODE_ENV'] || 'development',
      version: process.env['APP_VERSION'] || '1.0.0',
    },
    mixin: () => {
      const traceHeader = process.env['_X_AMZN_TRACE_ID'];
      if (traceHeader) {
        const traceId = traceHeader.split(';')[0]?.replace('Root=', '');
        return { aws_trace_id: traceId };
      }
      return {};
    },
    serializers: {
      err: customErrorSerializer,
      error: customErrorSerializer,
      req: reqSerializer,
      res: resSerializer,
    },
    redact: {
      paths: ['access_token', 'refresh_token', 'authorization', 'cookie'],
      remove: true,
    },
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
      bindings: (bindings) => ({
        pid: bindings['pid'],
        hostname: bindings['hostname'],
      }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  prettyStream
);
