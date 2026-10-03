// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LOG_CREDENTIAL_KEY_SUFFIXES, LOG_CREDENTIAL_KEYS, LOG_SCRUB_LIMITS } from '@lfx-one/shared/constants';
import type { LogScrubState } from '@lfx-one/shared/interfaces';

/** True when `key`, normalised (lowercased, non-alphanumerics stripped), names a credential. See `LOG_CREDENTIAL_KEYS`. */
function isCredentialKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (LOG_CREDENTIAL_KEYS as readonly string[]).includes(normalized) || LOG_CREDENTIAL_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Reads one property, turning a throwing getter into a placeholder so logging never throws into the caller. */
function read(target: object, key: PropertyKey): unknown {
  try {
    return (target as Record<PropertyKey, unknown>)[key];
  } catch {
    return '[Unserializable]';
  }
}

/**
 * ioredis (and node-redis) attach `command: { name, args }` to reply/abort errors, where `args` is
 * the raw argument list the caller passed — for a `SET` that is the unredacted cache key and the
 * whole serialized value (for the session store: the user's id/access/refresh tokens). Recognised
 * by shape wherever it appears, so only the command name is ever logged.
 */
function isRedisCommand(value: object): boolean {
  return typeof read(value, 'name') === 'string' && Array.isArray(read(value, 'args'));
}

function scrub(value: unknown, depth: number, state: LogScrubState): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (state.ancestors.has(value)) return '[Circular]';
  if (depth >= LOG_SCRUB_LIMITS.MAX_DEPTH || state.visited >= LOG_SCRUB_LIMITS.MAX_NODES) return '[Truncated]';
  state.visited++;

  if (isRedisCommand(value)) return { name: read(value, 'name') };

  // Mirror JSON.stringify: an object with toJSON (Date, Buffer, AxiosError, …) is logged as whatever
  // toJSON returns, so scrub that instead of the raw object. One returning itself is walked as-is.
  const toJSON = read(value, 'toJSON');
  if (typeof toJSON === 'function') {
    let json: unknown;
    try {
      json = toJSON.call(value);
    } catch {
      return '[Unserializable]';
    }
    if (json !== value) return scrub(json, depth + 1, state);
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => scrub(read(value, index), depth + 1, state));
    }

    // Own enumerable string keys only — the same set JSON.stringify (and so pino) would emit, which
    // keeps an Error's non-enumerable `message`/`stack` out exactly as before.
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = scrubEntry(key, read(value, key), depth + 1, state);
    }
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}

function scrubEntry(key: string, value: unknown, depth: number, state: LogScrubState): unknown {
  return isCredentialKey(key) ? '[REDACTED]' : scrub(value, depth, state);
}

/**
 * Deep-scrubs one top-level log field before it is written: a credential-named key (see
 * `LOG_CREDENTIAL_KEYS`) has its value replaced with `[REDACTED]` and a Redis client command is
 * reduced to its name, at any nesting depth. Plain objects, arrays and errors are rebuilt the way
 * JSON.stringify would emit them; primitives are returned unchanged.
 *
 * Keys are matched, string contents are not: a token interpolated into a message or a string value
 * (e.g. a pre-serialized request body) is not detected, so never build log text from credentials.
 * Used by the pino `formatters.log` hook and child-binding scrub; `customErrorSerializer` applies
 * the same scrub to error properties.
 */
export const scrubLogField = (key: string, value: unknown): unknown => {
  try {
    return scrubEntry(key, value, 0, { ancestors: new WeakSet(), visited: 0 });
  } catch {
    return '[Unserializable]';
  }
};

/**
 * Custom error serializer for Pino logging
 * Provides full stack traces in development for debugging while keeping production logs clean
 *
 * Development: Includes stack traces for local debugging
 * Production: Excludes stack traces unless LOG_LEVEL=debug (cleaner CloudWatch logs)
 *
 * Custom properties are deep-scrubbed (see `scrubLogField`), so a credential nested in an error —
 * ioredis' `err.command.args`, an upstream error body echoing `access_token` — never reaches the log.
 */
export const customErrorSerializer = (err: any) => {
  if (!err) return err;

  const serialized: any = {
    type: err.constructor?.name || err.name || 'Error',
    message: err.message || String(err),
  };

  // Add common error properties if they exist
  if (err.code) serialized.code = err.code;
  if (err.statusCode) serialized.statusCode = err.statusCode;
  if (err.status) serialized.status = err.status;

  // Include stack trace in development or when debug logging is enabled
  if (process.env['NODE_ENV'] !== 'production' || process.env['LOG_LEVEL'] === 'debug') {
    serialized.stack = err.stack;
  }

  // Only an object has custom properties — a thrown string is fully described by `message` above.
  if (typeof err !== 'object') return serialized;

  // Include any additional custom properties from error object
  const state: LogScrubState = { ancestors: new WeakSet([err]), visited: 0 };
  Object.keys(err).forEach((key) => {
    if (!['message', 'stack', 'name', 'constructor'].includes(key)) {
      serialized[key] = scrubEntry(key, read(err, key), 1, state);
    }
  });

  return serialized;
};
