// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

import { NatsService } from './nats.service';

/**
 * A malformed `NATS_URL` must fail with a message that names the setting.
 *
 * The constructor runs during module evaluation for EVERY SSR route -- it is reached through
 * `Auth0Service` -> `ProfileController` -> `server.ts` -- so an unguarded `new URL()` throw takes
 * the whole app down with a bare `TypeError: Invalid URL` and a stack trace naming internal file
 * paths. That is what a single missing `nats://` scheme produced in local testing.
 *
 * The failure stays fatal on purpose: a BFF that cannot reach NATS cannot resolve a project slug,
 * so every authorization check would deny and serving those pages would be worse than not
 * starting. What changes is that the error says which variable is wrong.
 */
describe('NatsService — NATS_URL parsing', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['a bare host:port with no scheme', '127.0.0.1:4223'],
    ['an empty-ish value', '   '],
    ['a value that is not a URL at all', 'not a url'],
  ])('rejects %s with an error naming NATS_URL and the expected shape', (_label, value) => {
    vi.stubEnv('NATS_URL', value);

    // Not a bare TypeError: the message must be actionable, or an operator sees only
    // "Invalid URL" on every route with no indication of which setting caused it.
    expect(() => new NatsService()).toThrow(/NATS_URL/);
    expect(() => new NatsService()).toThrow(/nats:\/\/host:4222/);
  });

  it('accepts a well-formed nats:// URL and keeps its host and port', () => {
    vi.stubEnv('NATS_URL', 'nats://127.0.0.1:4223');

    const service = new NatsService() as unknown as { natsHostname: string; natsPort: number };

    expect(service.natsHostname).toBe('127.0.0.1');
    expect(service.natsPort).toBe(4223);
  });

  it('defaults the port to 4222 when the URL omits one', () => {
    // `parseInt('')` is NaN, so the `|| 4222` fallback is what supplies the default -- a guard
    // that only a port-less URL reaches.
    vi.stubEnv('NATS_URL', 'nats://lfx-platform-nats.lfx.svc.cluster.local');

    const service = new NatsService() as unknown as { natsPort: number };

    expect(service.natsPort).toBe(4222);
  });
});
