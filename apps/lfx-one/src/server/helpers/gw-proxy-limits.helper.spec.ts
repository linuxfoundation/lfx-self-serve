// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_PROXY_DEFAULT_MAX_BODY_BYTES, GW_PROXY_DEFAULT_TIMEOUT_MS } from '@lfx-one/shared/constants';
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
});
