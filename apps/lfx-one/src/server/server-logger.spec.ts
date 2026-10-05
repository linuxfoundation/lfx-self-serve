// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ReplyError } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ACCESS_TOKEN = 'eyJ-access-token-secret';
const REFRESH_TOKEN = 'v1.refresh-token-secret';
const RAW_KEY = 'lfx:session:v1:alice-session-id';

/**
 * Drives the real serverLogger (production stream → stdout) end to end, so the assertion is on
 * the emitted line rather than on a serializer called in isolation. Each test re-imports the logger
 * (and its OpenTelemetry graph) after `resetModules`; a cold first import can approach vitest's 5s
 * default, hence the longer timeout.
 */
describe('serverLogger credential scrubbing', { timeout: 20_000 }, () => {
  let lines: string[];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', 'info');
    lines = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('never emits a Valkey ReplyError command args or a nested session token', async () => {
    const { serverLogger } = await import('./server-logger');
    const err = new ReplyError("OOM command not allowed when used memory > 'maxmemory'.");
    err.command = { name: 'set', args: [RAW_KEY, JSON.stringify({ data: { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN } }), 'EX', 3600] };

    serverLogger.warn(
      { operation: 'valkey_set', err, data: { cache_key: 'lfx:session:v1:***', session: { access_token: ACCESS_TOKEN } } },
      'Cache write failed'
    );
    serverLogger.child({ request_id: 'r1' }).warn({ data: { nested: { deeper: { refresh_token: REFRESH_TOKEN } } } }, 'child');

    const output = lines.join('');
    expect(lines.length).toBe(2);
    expect(output).not.toContain(ACCESS_TOKEN);
    expect(output).not.toContain(REFRESH_TOKEN);
    expect(output).not.toContain(RAW_KEY);

    const first = JSON.parse(lines[0]);
    expect(first.err.type).toBe('ReplyError');
    expect(first.err.command).toEqual({ name: 'set' });
    expect(first.data.cache_key).toBe('lfx:session:v1:***');
  });

  it('scrubs child-logger bindings, including those of a grandchild', async () => {
    const { serverLogger } = await import('./server-logger');

    serverLogger
      .child({ session: { access_token: ACCESS_TOKEN } })
      .child({ meta: { command: { name: 'set', args: [RAW_KEY, REFRESH_TOKEN] } } })
      .info('bound');

    const output = lines.join('');
    expect(lines.length).toBe(1);
    expect(output).not.toContain(ACCESS_TOKEN);
    expect(output).not.toContain(REFRESH_TOKEN);
    expect(output).not.toContain(RAW_KEY);
    expect(JSON.parse(lines[0]).meta.command).toEqual({ name: 'set' });
  });

  it('logs a throwing top-level getter as [Unserializable] instead of throwing', async () => {
    const { serverLogger } = await import('./server-logger');
    const throwing = (extra: Record<string, unknown>) =>
      Object.defineProperty(extra, 'boom', {
        enumerable: true,
        get() {
          throw new Error('getter failed');
        },
      });

    expect(() => serverLogger.info(throwing({ ok: 1 }), 'call')).not.toThrow();
    expect(() => serverLogger.child(throwing({ ok: 2 })).info('child')).not.toThrow();

    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0])).toMatchObject({ ok: 1, boom: '[Unserializable]', msg: 'call' });
    expect(JSON.parse(lines[1])).toMatchObject({ ok: 2, boom: '[Unserializable]', msg: 'child' });
  });

  it('logs a marker instead of throwing when listing a log object or child bindings throws', async () => {
    const { serverLogger } = await import('./server-logger');
    const unlistable = () =>
      new Proxy(
        { access_token: 'tok-unlistable' },
        {
          ownKeys() {
            throw new Error('ownKeys failed');
          },
        }
      );

    expect(() => serverLogger.info(unlistable(), 'call')).not.toThrow();
    expect(() => serverLogger.child(unlistable()).info('child')).not.toThrow();

    expect(lines.length).toBe(2);
    expect(lines.join('')).not.toContain('tok-unlistable');
    expect(JSON.parse(lines[0])).toMatchObject({ '[Unserializable]': '[Unserializable]', msg: 'call' });
    expect(JSON.parse(lines[1])).toMatchObject({ '[Unserializable]': '[Unserializable]', msg: 'child' });
  });
});
