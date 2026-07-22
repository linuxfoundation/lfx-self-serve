// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { serverLogger } from '../server-logger';

/**
 * Builds Pino-compatible [data, message] args from a raw console argument list.
 *
 * - Error instances are placed under the `err` key so `customErrorSerializer` runs.
 * - HttpErrorResponse-like objects (Angular's HTTP error shape) are converted to a
 *   structured `err` entry so the URL/status are machine-readable.
 * - Plain objects are merged into the data payload.
 * - Primitives are concatenated into the message string.
 */
function buildLogArgs(args: any[]): [Record<string, unknown>, string] {
  const parts: string[] = [];
  let errValue: unknown;
  const extra: Record<string, unknown> = {};

  for (const arg of args) {
    if (arg instanceof Error) {
      // First error wins; subsequent errors are stringified into the message so
      // nothing is silently dropped (e.g. console.error('ctx', err1, err2)).
      if (errValue === undefined) errValue = arg;
      else parts.push(arg.message || String(arg));
    } else if (arg !== null && typeof arg === 'object' && arg.ok === false && 'status' in arg && 'statusText' in arg && 'url' in arg) {
      // Angular HttpErrorResponse shape (ok === false distinguishes it from
      // a success HttpResponse which carries the same status/statusText/url).
      // Include the error body regardless of type (string or object) so upstream
      // failure text is not lost in production logs.
      if (errValue === undefined) {
        errValue = {
          type: 'HttpErrorResponse',
          message: arg.message || `Http failure response for ${arg.url}: ${arg.status} ${arg.statusText}`,
          statusCode: arg.status,
          statusText: arg.statusText,
          url: arg.url,
          ...(arg.error != null ? { detail: arg.error } : {}),
        };
      } else {
        parts.push(arg.message || String(arg));
      }
    } else if (arg !== null && typeof arg === 'object') {
      Object.assign(extra, arg);
    } else {
      // Use String() instead of JSON.stringify() — JSON.stringify throws on bigint
      // and symbol, which would crash SSR rendering for a single bad console call.
      parts.push(typeof arg === 'string' ? arg : String(arg));
    }
  }

  const data: Record<string, unknown> = { ...extra };
  if (errValue !== undefined) data['err'] = errValue;

  return [data, parts.join(' ') || 'console output'];
}

/**
 * Redirects `console.error`, `console.warn`, `console.log`, and `console.info`
 * through Pino's `serverLogger` so all output in production is single-line
 * structured JSON.
 *
 * Only activates in production (`NODE_ENV === 'production'`). In development,
 * pino-pretty already formats structured logs in a human-readable way and the
 * raw console output is acceptable for local debugging.
 *
 * Call once, early in server startup, before Angular SSR is registered.
 */
export function initializeServerConsoleOverride(): void {
  if (process.env['NODE_ENV'] !== 'production') return;

  console.error = (...args: any[]) => {
    const [data, msg] = buildLogArgs(args);
    serverLogger.error(data, msg);
  };

  console.warn = (...args: any[]) => {
    const [data, msg] = buildLogArgs(args);
    serverLogger.warn(data, msg);
  };

  console.log = (...args: any[]) => {
    const [data, msg] = buildLogArgs(args);
    serverLogger.info({ ...data, console: 'log' }, msg);
  };

  // console.info is used in several Angular components (app.component.ts,
  // header.component.ts, persona.service.ts, intercom.service.ts, etc.) and
  // would otherwise bypass Pino during SSR.
  console.info = (...args: any[]) => {
    const [data, msg] = buildLogArgs(args);
    serverLogger.info({ ...data, console: 'info' }, msg);
  };
}
