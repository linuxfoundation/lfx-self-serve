// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_PROXY_DEFAULT_MAX_BODY_BYTES, GW_PROXY_DEFAULT_TIMEOUT_MS, NODE_MAX_TIMER_DELAY_MS } from '@lfx-one/shared/constants';
import { afterEach, describe, expect, it } from 'vitest';

import { getGwProxyMaxBodyBytes, getGwProxyTimeoutMs } from './gw-proxy-limits.helper';

/**
 * #2263 asks for both limits as deployment variables. They were compiled-in constants, so a slow
 * upstream or a larger media ceiling could not be accommodated without a code change.
 */
describe('gw proxy limits', () => {
  const originalTimeout = process.env['GW_PROXY_TIMEOUT_MS'];
  const originalBody = process.env['GW_PROXY_MAX_BODY_BYTES'];

  afterEach(() => {
    process.env['GW_PROXY_TIMEOUT_MS'] = originalTimeout;
    process.env['GW_PROXY_MAX_BODY_BYTES'] = originalBody;
    if (originalTimeout === undefined) delete process.env['GW_PROXY_TIMEOUT_MS'];
    if (originalBody === undefined) delete process.env['GW_PROXY_MAX_BODY_BYTES'];
  });

  it('falls back to the compiled defaults when unset', () => {
    delete process.env['GW_PROXY_TIMEOUT_MS'];
    delete process.env['GW_PROXY_MAX_BODY_BYTES'];

    expect(getGwProxyTimeoutMs()).toBe(GW_PROXY_DEFAULT_TIMEOUT_MS);
    expect(getGwProxyMaxBodyBytes()).toBe(GW_PROXY_DEFAULT_MAX_BODY_BYTES);
  });

  it('takes a valid override', () => {
    process.env['GW_PROXY_TIMEOUT_MS'] = '90000';
    process.env['GW_PROXY_MAX_BODY_BYTES'] = '209715200';

    expect(getGwProxyTimeoutMs()).toBe(90_000);
    expect(getGwProxyMaxBodyBytes()).toBe(209_715_200);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['non-numeric', 'sixty seconds'],
    ['fractional', '1.5'],
    ['empty', '   '],
  ])('falls back on a %s value rather than taking it', (_label, value) => {
    // Zero is the one that matters most: it would make every request time out instantly, or every
    // body too large — an outage that looks nothing like a mis-set tuning knob.
    process.env['GW_PROXY_TIMEOUT_MS'] = value;
    process.env['GW_PROXY_MAX_BODY_BYTES'] = value;

    expect(getGwProxyTimeoutMs()).toBe(GW_PROXY_DEFAULT_TIMEOUT_MS);
    expect(getGwProxyMaxBodyBytes()).toBe(GW_PROXY_DEFAULT_MAX_BODY_BYTES);
  });

  it('does not throw on a bad value, since this is read on the request path', () => {
    process.env['GW_PROXY_TIMEOUT_MS'] = 'nonsense';

    expect(() => getGwProxyTimeoutMs()).not.toThrow();
  });

  it('rejects a timeout above Node’s maximum timer delay rather than letting it overflow', () => {
    // The failure this guards is silent and inverted: `AbortSignal.timeout` overflows its 32-bit
    // signed delay instead of saturating, so a value meaning "about 35 days" aborts on the next
    // tick. Every proxied request would 408 instantly and the env var would read as generous.
    process.env['GW_PROXY_TIMEOUT_MS'] = '3000000000';

    expect(getGwProxyTimeoutMs()).toBe(GW_PROXY_DEFAULT_TIMEOUT_MS);
  });

  it('accepts a timeout exactly at the maximum timer delay', () => {
    // The boundary is inclusive — 2^31-1 is representable, and rejecting it would be an off-by-one
    // that silently ignores a legitimate (if extreme) override.
    process.env['GW_PROXY_TIMEOUT_MS'] = String(NODE_MAX_TIMER_DELAY_MS);

    expect(getGwProxyTimeoutMs()).toBe(NODE_MAX_TIMER_DELAY_MS);
  });

  it('rejects a body cap past the safe-integer range', () => {
    // Beyond 2^53-1 the parsed value is no longer exact, so comparisons against a running byte
    // count stop meaning what they say. The body cap has no other ceiling — it is compared, not
    // handed to a timer.
    process.env['GW_PROXY_MAX_BODY_BYTES'] = '9007199254740993';

    expect(getGwProxyMaxBodyBytes()).toBe(GW_PROXY_DEFAULT_MAX_BODY_BYTES);
  });

  it('accepts a body cap far above the timer ceiling, which does not apply to it', () => {
    // Guards against the two bounds being conflated: a 4GB media ceiling is a legitimate override
    // and must not inherit the timeout's 2^31-1 limit.
    process.env['GW_PROXY_MAX_BODY_BYTES'] = '4294967296';

    expect(getGwProxyMaxBodyBytes()).toBe(4_294_967_296);
  });

  it('is read per call, so a later env change is observed', () => {
    // The stated contract for both knobs. The body cap briefly broke it by being captured in a
    // constructor default on a controller the route module instantiates at import time.
    process.env['GW_PROXY_MAX_BODY_BYTES'] = '1000';
    expect(getGwProxyMaxBodyBytes()).toBe(1000);

    process.env['GW_PROXY_MAX_BODY_BYTES'] = '2000';
    expect(getGwProxyMaxBodyBytes()).toBe(2000);
  });
});
