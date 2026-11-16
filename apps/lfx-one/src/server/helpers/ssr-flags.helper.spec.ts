// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETINGS_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { User } from '@lfx-one/shared/interfaces';
import { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveSsrFlags } from './ssr-flags.helper';

const isFlagEnabled = vi.fn();

vi.mock('../services/launchdarkly-server.service', () => ({
  LaunchDarklyServerService: { getInstance: () => ({ isFlagEnabled }) },
}));

// As the `/**` SSR mount sees it: `path` is always `/`.
const request = (url: string): Request => ({ path: '/', originalUrl: url }) as Request;
const user = { preferred_username: 'pat', username: 'pat-other', name: 'Pat Viewer', email: 'pat@example.org' } as User;

describe('resolveSsrFlags', () => {
  beforeEach(() => {
    isFlagEnabled.mockReset().mockResolvedValue(true);
  });

  it('evaluates the redesign flag for a meeting page with the browser context', async () => {
    const req = request('/meetings/91000000001?occurrence=1700000000000');

    expect(await resolveSsrFlags(req, user)).toEqual({ meetingsRedesign: true });
    expect(isFlagEnabled).toHaveBeenCalledWith(req, MEETINGS_REDESIGN_FLAG, false, { key: 'pat', name: 'Pat Viewer', email: 'pat@example.org' });
  });

  it.each(['/meetings', '/meetings/create', '/meetings/123/details', '/groups/123'])('skips %s', async (path) => {
    expect(await resolveSsrFlags(request(path), user)).toEqual({});
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it('evaluates the redesign flag for the meeting not-found page, which the redesign also pairs', async () => {
    expect(await resolveSsrFlags(request('/meetings/not-found'), user)).toEqual({ meetingsRedesign: true });
  });

  it('evaluates signed-out visitors as one anonymous context', async () => {
    isFlagEnabled.mockResolvedValue(false);
    const req = request('/meetings/123?password=secret');

    expect(await resolveSsrFlags(req, null)).toEqual({ meetingsRedesign: false });
    expect(isFlagEnabled).toHaveBeenCalledWith(req, MEETINGS_REDESIGN_FLAG, false, { key: 'anonymous-meeting-visitor', anonymous: true });
  });

  it('skips other pages for signed-out visitors', async () => {
    expect(await resolveSsrFlags(request('/groups/123'), null)).toEqual({});
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it('falls back to the username claim like the browser does', async () => {
    await resolveSsrFlags(request('/meetings/123'), { 'https://sso.linuxfoundation.org/claims/username': 'claimed' } as unknown as User);

    expect(isFlagEnabled).toHaveBeenCalledWith(expect.anything(), MEETINGS_REDESIGN_FLAG, false, { key: 'claimed', name: '', email: '' });
  });

  it('keeps the default when the user has no key', async () => {
    expect(await resolveSsrFlags(request('/meetings/123'), {} as User)).toEqual({ meetingsRedesign: false });
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });
});
