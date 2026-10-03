// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LOG_SCRUB_LIMITS } from '@lfx-one/shared/constants';
import { ReplyError } from 'ioredis';
import { describe, expect, it } from 'vitest';

import { customErrorSerializer, scrubLogField } from './error-serializer';

const ACCESS_TOKEN = 'eyJ-access-token-secret';
const REFRESH_TOKEN = 'v1.refresh-token-secret';
const RAW_KEY = 'lfx:session:v1:alice-session-id';

/** The error ioredis rejects a failed `SET key value EX ttl` with — `DataHandler.returnError` attaches `command`. */
function valkeyReplyError(): Error {
  const err = new ReplyError("OOM command not allowed when used memory > 'maxmemory'.");
  err.command = {
    name: 'set',
    args: [RAW_KEY, JSON.stringify({ data: { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN } }), 'EX', 3600],
  };
  return err;
}

describe('customErrorSerializer', () => {
  it('drops the raw key and stored value from an ioredis ReplyError, keeping the command name', () => {
    const serialized = customErrorSerializer(valkeyReplyError());
    const line = JSON.stringify(serialized);

    expect(line).not.toContain(ACCESS_TOKEN);
    expect(line).not.toContain(REFRESH_TOKEN);
    expect(line).not.toContain(RAW_KEY);
    expect(serialized.command).toEqual({ name: 'set' });
    expect(serialized.message).toContain('OOM command not allowed');
    expect(serialized.type).toBe('ReplyError');
  });

  it('scrubs a Redis command on an error nested inside another error', () => {
    const wrapper = Object.assign(new Error('wrapped'), { originalError: valkeyReplyError(), previousErrors: [valkeyReplyError()] });
    const line = JSON.stringify(customErrorSerializer(wrapper));

    expect(line).not.toContain(ACCESS_TOKEN);
    expect(line).not.toContain(RAW_KEY);
  });

  it('redacts credential-named properties at any depth', () => {
    const err = Object.assign(new Error('upstream failed'), {
      errorBody: { session: { access_token: ACCESS_TOKEN, nested: [{ refreshToken: REFRESH_TOKEN }] } },
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'set-cookie': ['appSession=abc'] },
      impersonationToken: ACCESS_TOKEN,
    });
    const serialized = customErrorSerializer(err);
    const line = JSON.stringify(serialized);

    expect(line).not.toContain(ACCESS_TOKEN);
    expect(line).not.toContain(REFRESH_TOKEN);
    expect(line).not.toContain('appSession=abc');
    expect(serialized.errorBody.session.access_token).toBe('[REDACTED]');
  });

  it('keeps non-credential properties and survives cycles', () => {
    const err: any = Object.assign(new Error('boom'), { cache_key: 'lfx:session:v1:***', token_type: 'Bearer', metadata: { count: 2 } });
    err.self = err;
    const serialized = customErrorSerializer(err);

    expect(serialized.cache_key).toBe('lfx:session:v1:***');
    expect(serialized.token_type).toBe('Bearer');
    expect(serialized.metadata).toEqual({ count: 2 });
    expect(serialized.self).toBe('[Circular]');
  });

  it('serializes a thrown string without splitting it into character keys', () => {
    expect(customErrorSerializer('boom')).toEqual(expect.objectContaining({ type: 'String', message: 'boom' }));
    expect(customErrorSerializer('boom')).not.toHaveProperty('0');
  });

  it('replaces a throwing getter instead of throwing into the caller', () => {
    const err = Object.defineProperty(new Error('boom'), 'detail', {
      enumerable: true,
      get: () => {
        throw new Error('getter');
      },
    });

    expect(customErrorSerializer(err).detail).toBe('[Unserializable]');
  });
});

describe('scrubLogField', () => {
  it('redacts a session bundle nested under log data', () => {
    const scrubbed = scrubLogField('data', { session: { data: { id_token: 'id', access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN } } });

    expect(JSON.stringify(scrubbed)).not.toMatch(/eyJ-access|v1\.refresh|"id"/);
  });

  it('redacts a top-level credential field and mirrors toJSON', () => {
    const when = new Date('2026-01-01T00:00:00Z');

    expect(scrubLogField('access_token', ACCESS_TOKEN)).toBe('[REDACTED]');
    expect(scrubLogField('data', { when })).toEqual({ when: when.toJSON() });
  });

  it('walks an object whose toJSON returns itself', () => {
    const value = {
      access_token: ACCESS_TOKEN,
      toJSON() {
        return this;
      },
    };

    expect(JSON.stringify(scrubLogField('data', value))).not.toContain(ACCESS_TOKEN);
  });

  it('reduces a Redis command to its name under any key, leaving other `command` values alone', () => {
    const scrubbed = scrubLogField('data', { cmd: { name: 'set', args: [RAW_KEY, ACCESS_TOKEN] }, command: { name: 'deploy', target: 'prod' } });

    expect(scrubbed).toEqual({ cmd: { name: 'set' }, command: { name: 'deploy', target: 'prod' } });
  });

  it('redacts other credential key spellings', () => {
    const scrubbed = scrubLogField('data', { apiKey: 'a', 'x-api-key': 'b', client_secret: 'c', tokens: { a: 'd' }, jwt: 'e', sid: 'f', page_size: 10 });

    expect(scrubbed).toEqual({
      apiKey: '[REDACTED]',
      'x-api-key': '[REDACTED]',
      client_secret: '[REDACTED]',
      tokens: '[REDACTED]',
      jwt: '[REDACTED]',
      sid: '[REDACTED]',
      page_size: 10,
    });
  });

  it('redacts password fields under any prefix', () => {
    const scrubbed = scrubLogField('data', {
      password: 'a',
      current_password: 'b',
      new_password: 'c',
      confirmPassword: 'd',
      meeting_passwd: 'e',
      password_policy: 'strict',
    });

    expect(scrubbed).toEqual({
      password: '[REDACTED]',
      current_password: '[REDACTED]',
      new_password: '[REDACTED]',
      confirmPassword: '[REDACTED]',
      meeting_passwd: '[REDACTED]',
      password_policy: 'strict',
    });
  });

  it('stops walking a wide array at the node budget, ending it with one truncation marker', () => {
    const scrubbed = scrubLogField(
      'items',
      Array.from({ length: LOG_SCRUB_LIMITS.MAX_NODES * 2 }, (_, index) => `item-${index}`)
    ) as unknown[];

    expect(scrubbed).toHaveLength(LOG_SCRUB_LIMITS.MAX_NODES + 1);
    expect(scrubbed[0]).toBe('item-0');
    expect(scrubbed.at(-1)).toBe('[Truncated]');
  });

  it('stops walking a wide object at the node budget, collapsing the rest into one truncation key', () => {
    const wide = Object.fromEntries(Array.from({ length: LOG_SCRUB_LIMITS.MAX_NODES * 2 }, (_, index) => [`k${index}`, index]));
    const scrubbed = scrubLogField('data', wide) as Record<string, unknown>;

    expect(Object.keys(scrubbed)).toHaveLength(LOG_SCRUB_LIMITS.MAX_NODES + 1);
    expect(scrubbed['k0']).toBe(0);
    expect(scrubbed['[Truncated]']).toBe('[Truncated]');
  });

  it('shares one node budget across nested containers', () => {
    const rows = Array.from({ length: LOG_SCRUB_LIMITS.MAX_NODES }, () => ({ a: 1, b: 2 }));
    const scrubbed = scrubLogField('rows', rows) as unknown[];

    // Each row costs three entries (itself, `a`, `b`), so the budget runs out a third of the way in.
    expect(scrubbed.length).toBeLessThan(LOG_SCRUB_LIMITS.MAX_NODES / 2);
    expect(scrubbed.at(-1)).toBe('[Truncated]');
  });
});
