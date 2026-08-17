// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildConsoleHandoffUrl } from './cla-handoff.utils';

const BASE = 'https://easycla.dev.communitybridge.org/';
const CLA_GROUP = '032a4e39-c5c9-4653-8bdd-202c7257ed45';
const CLA_USER = '40dc8def-e014-11ec-8750-4225fa2d71d7';
const RETURN_URL = 'https://app.dev.lfx.dev/profile/clas';

describe('buildConsoleHandoffUrl', () => {
  it('builds the decision-screen URL the Console expects', () => {
    expect(buildConsoleHandoffUrl(BASE, CLA_GROUP, CLA_USER, RETURN_URL)).toBe(
      `https://easycla.dev.communitybridge.org/#/cla/project/${CLA_GROUP}/user/${CLA_USER}?redirect=https%3A%2F%2Fapp.dev.lfx.dev%2Fprofile%2Fclas`
    );
  });

  it('percent-encodes the return URL', () => {
    const url = buildConsoleHandoffUrl(BASE, CLA_GROUP, CLA_USER, RETURN_URL);

    // The raw form would terminate the query value at the first `&` and confuse the
    // Console's param parsing; the legacy producer appends it raw because its own return
    // URLs are path-only.
    expect(url).toContain('redirect=https%3A%2F%2Fapp.dev.lfx.dev%2Fprofile%2Fclas');
    expect(url).not.toContain('redirect=https://');
  });

  it('preserves query parameters already on the return URL', () => {
    const url = buildConsoleHandoffUrl(BASE, CLA_GROUP, CLA_USER, 'https://app.dev.lfx.dev/profile/clas?signed=1');

    expect(url).toContain('redirect=https%3A%2F%2Fapp.dev.lfx.dev%2Fprofile%2Fclas%3Fsigned%3D1');
  });

  it('does not double the separator when the base has a trailing slash', () => {
    expect(buildConsoleHandoffUrl(BASE, CLA_GROUP, CLA_USER, RETURN_URL)).not.toContain('//#/');
  });

  it('inserts the separator when the base has none', () => {
    const url = buildConsoleHandoffUrl('https://easycla.dev.communitybridge.org', CLA_GROUP, CLA_USER, RETURN_URL);

    expect(url).toContain('https://easycla.dev.communitybridge.org/#/cla/project/');
  });

  it('tolerates repeated trailing slashes on the base', () => {
    const url = buildConsoleHandoffUrl('https://easycla.dev.communitybridge.org///', CLA_GROUP, CLA_USER, RETURN_URL);

    expect(url).toContain('https://easycla.dev.communitybridge.org/#/cla/project/');
  });

  it('works against the production Console base', () => {
    const url = buildConsoleHandoffUrl('https://contributor.easycla.lfx.linuxfoundation.org/', CLA_GROUP, CLA_USER, 'https://app.lfx.dev/profile/clas');

    expect(url).toBe(
      `https://contributor.easycla.lfx.linuxfoundation.org/#/cla/project/${CLA_GROUP}/user/${CLA_USER}?redirect=https%3A%2F%2Fapp.lfx.dev%2Fprofile%2Fclas`
    );
  });
});
