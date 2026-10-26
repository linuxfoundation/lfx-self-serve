// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { debug, info, success, warning, error, startOperation } = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  startOperation: vi.fn(() => 0),
}));

vi.mock('./logger.service', () => ({ logger: { debug, info, success, warning, error, startOperation } }));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/identity.utils')),
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/api.constants')),
  ...(await import('../../../../../packages/shared/src/constants/profile.constants')),
}));

import { CdpService } from './cdp.service';

const LFID = 'jane-doe-lfid';
const REQ = undefined;

/** Every metadata object any logger call received, flattened to one searchable string. */
function loggedMetadata(): string {
  return JSON.stringify([debug.mock.calls, info.mock.calls, success.mock.calls, warning.mock.calls, error.mock.calls, startOperation.mock.calls]);
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('CdpService.getWorkExperiencesForExistingMember', () => {
  let service: CdpService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['CDP_ACCESS_TOKEN'] = 'test-token';
    service = new CdpService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['CDP_ACCESS_TOKEN'];
  });

  // #4314 — this path runs automatically on every no-grant Org Lens visit, for people who may never
  // open their profile. The caller's username must not reach the log sink from any line on it.
  it('logs no caller identity when CDP has no member for the user', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Member not found' }, 404));

    await expect(service.getWorkExperiencesForExistingMember(REQ, LFID)).resolves.toEqual([]);

    expect(loggedMetadata()).not.toContain(LFID);
  });

  it('logs no caller identity when the member resolves', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ memberId: 'member-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ workExperiences: [{ id: 'we-1', organizationName: 'Acme Motors', jobTitle: 'Engineer', startDate: '2020-01-01' }] })
      );

    const entries = await service.getWorkExperiencesForExistingMember(REQ, LFID);

    expect(entries).toHaveLength(1);
    expect(entries[0].organization).toBe('Acme Motors');
    expect(loggedMetadata()).not.toContain(LFID);
  });

  // The create path is what writes a CDP profile — and what logs the LFID at INFO. A passive probe
  // must reach neither.
  it('never creates a CDP member', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Member not found' }, 404));

    await service.getWorkExperiencesForExistingMember(REQ, LFID);

    const posted = fetchMock.mock.calls.map(([url]) => String(url));
    expect(posted.some((url) => url.includes('/members') && !url.includes('resolve'))).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });
});
