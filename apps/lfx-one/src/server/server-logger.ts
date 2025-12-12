// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import pino from 'pino';
import pinoPretty from 'pino-pretty';

import { customErrorSerializer } from './helpers/error-serializer';

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
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    redact: {
      paths:
        process.env['NODE_ENV'] !== 'production'
          ? ['req.headers.*', 'res.headers.*', 'access_token', 'refresh_token', 'authorization', 'cookie']
          : ['access_token', 'refresh_token', 'authorization', 'cookie', 'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
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
