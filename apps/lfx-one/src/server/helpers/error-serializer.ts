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
export function readLogField(target: object, key: PropertyKey): unknown {
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
  return typeof readLogField(value, 'name') === 'string' && Array.isArray(readLogField(value, 'args'));
}

function scrub(value: unknown, depth: number, state: LogScrubState): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (state.ancestors.has(value)) return '[Circular]';
  if (depth >= LOG_SCRUB_LIMITS.MAX_DEPTH) return '[Truncated]';

  if (isRedisCommand(value)) return { name: readLogField(value, 'name') };

  // Mirror JSON.stringify: an object with toJSON (Date, Buffer, AxiosError, …) is logged as whatever
  // toJSON returns, so scrub that instead of the raw object. One returning itself is walked as-is.
  const toJSON = readLogField(value, 'toJSON');
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
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!spend(state)) {
          result.push('[Truncated]');
          break;
        }
        result.push(scrub(readLogField(value, index), depth + 1, state));
      }
      return result;
    }

    // Own enumerable string keys only — the same set JSON.stringify (and so pino) would emit, which
    // keeps an Error's non-enumerable `message`/`stack` out exactly as before.
    return scrubProperties(value, Object.keys(value), depth + 1, state, {});
  } finally {
    state.ancestors.delete(value);
  }
}

function scrubEntry(key: string, value: unknown, depth: number, state: LogScrubState): unknown {
  return isCredentialKey(key) ? '[REDACTED]' : scrub(value, depth, state);
}

/** Charges one array element or object property to the walk's budget; false once `LOG_SCRUB_LIMITS.MAX_NODES` is spent. */
function spend(state: LogScrubState): boolean {
  if (state.visited >= LOG_SCRUB_LIMITS.MAX_NODES) return false;
  state.visited++;
  return true;
}

/** Scrubs `keys` of `source` into `result`; once the budget is spent the rest collapse into a single `[Truncated]` key. */
function scrubProperties(source: object, keys: string[], depth: number, state: LogScrubState, result: Record<string, unknown>): Record<string, unknown> {
  for (const key of keys) {
    if (!spend(state)) {
      result['[Truncated]'] = '[Truncated]';
      break;
    }
    result[key] = scrubEntry(key, readLogField(source, key), depth, state);
  }
  return result;
}

/**
 * Deep-scrubs one top-level log field before it is written: a credential-named key (see
 * `LOG_CREDENTIAL_KEYS`) has its value replaced with `[REDACTED]` and a Redis client command is
 * reduced to its name, at any nesting depth. Plain objects, arrays and errors are rebuilt the way
 * JSON.stringify would emit them; primitives are returned unchanged.
 *
 * Keys are matched, string contents are not: a token interpolated into a message or a string value
 * (e.g. a pre-serialized request body) is not detected, so never build log text from credentials.
 * `scrubLogRecord` applies it to every field of a log call or child binding under one shared
 * budget; `customErrorSerializer` applies the same scrub to error properties.
 */
export const scrubLogField = (key: string, value: unknown): unknown => {
  try {
    return scrubEntry(key, value, 0, { ancestors: new WeakSet(), visited: 0 });
  } catch {
    return '[Unserializable]';
  }
};

/**
 * Applies `scrubLogField` to every own enumerable field of one log call (or one set of child
 * bindings), sharing a single `LOG_SCRUB_LIMITS.MAX_NODES` budget across all of them so the whole
 * call stays bounded; each top-level field is charged too, and once the budget is spent the
 * remaining fields collapse into a single `[Truncated]` key. `passthrough` fields are copied as-is
 * (read guarded) without being charged — they are left for a pino serializer that bounds them itself.
 */
export const scrubLogRecord = (record: object, passthrough: readonly string[]): Record<string, unknown> => {
  const state: LogScrubState = { ancestors: new WeakSet(), visited: 0 };
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (passthrough.includes(key)) {
      result[key] = readLogField(record, key);
    } else if (!spend(state)) {
      result['[Truncated]'] = '[Truncated]';
    } else {
      try {
        result[key] = scrubEntry(key, readLogField(record, key), 0, state);
      } catch {
        result[key] = '[Unserializable]';
      }
    }
  }
  return result;
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
  const keys = Object.keys(err).filter((key) => !['message', 'stack', 'name', 'constructor'].includes(key));
  return scrubProperties(err, keys, 1, { ancestors: new WeakSet([err]), visited: 0 }, serialized);
};
