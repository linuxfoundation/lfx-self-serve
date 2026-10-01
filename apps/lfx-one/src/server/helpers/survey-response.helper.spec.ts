// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { QueryServiceResponse, SurveyResponseRecord } from '@lfx-one/shared/interfaces';
import { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUsernameFromAuth, getEffectiveEmail } = vi.hoisted(() => ({
  getUsernameFromAuth: vi.fn(),
  getEffectiveEmail: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth,
  getEffectiveEmail,
  // Real implementation strips the provider prefix; pinned here so the filters_or assertions
  // exercise the strip without importing the full auth-helper module graph.
  stripAuthPrefix: (value: string) => (value.includes('|') ? value.substring(value.indexOf('|') + 1) : value),
  // Composed from the mocks above so per-test identity control is unchanged.
  resolveUserIdentity: async (req: Request) => {
    const raw: string | null = await getUsernameFromAuth(req);
    const username = raw && raw.includes('|') ? raw.substring(raw.indexOf('|') + 1) : raw;
    return { email: getEffectiveEmail(req), username };
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn() } }));

import { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { fetchCurrentUserSurveyResponses } from './survey-response.helper';

const req = {} as unknown as Request;

function responseRow(overrides: Partial<SurveyResponseRecord>): SurveyResponseRecord {
  return {
    uid: 'resp-1',
    survey_uid: 'survey-1',
    survey_title: 'Board Survey',
    survey_status: 'sent',
    is_nps_survey: true,
    is_project_survey: false,
    committee_category: 'Board',
    committee_name: 'Board',
    creator_name: 'ED',
    survey_created_at: '2026-01-01T00:00:00Z',
    survey_last_modified_at: '2026-01-01T00:00:00Z',
    total_responses: 0,
    total_recipients: 1,
    ...overrides,
  };
}

function page(rows: SurveyResponseRecord[], pageToken?: string): QueryServiceResponse<SurveyResponseRecord> {
  return { resources: rows.map((data) => ({ type: 'survey_response', id: `survey_response:${data.uid}`, data })), ...(pageToken && { page_token: pageToken }) };
}

function mockProxy() {
  return { proxyRequest: vi.fn() };
}

describe('fetchCurrentUserSurveyResponses', () => {
  beforeEach(() => {
    getUsernameFromAuth.mockReset();
    getEffectiveEmail.mockReset();
  });

  it('returns [] without calling the proxy when neither email nor username resolves', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    getEffectiveEmail.mockReturnValue(null);
    const proxy = mockProxy();

    const rows = await fetchCurrentUserSurveyResponses(req, proxy as unknown as MicroserviceProxyService);

    expect(rows).toEqual([]);
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('matches by email only when no username resolves', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    getEffectiveEmail.mockReturnValue('invitee@example.com');
    const proxy = mockProxy();
    proxy.proxyRequest.mockResolvedValue(page([]));

    await fetchCurrentUserSurveyResponses(req, proxy as unknown as MicroserviceProxyService);

    expect(proxy.proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ type: 'survey_response', filters_or: ['email:invitee@example.com'] })
    );
  });

  it('matches by username only (provider prefix stripped) when no email resolves', async () => {
    getUsernameFromAuth.mockResolvedValue('auth0|someuser');
    getEffectiveEmail.mockReturnValue(null);
    const proxy = mockProxy();
    proxy.proxyRequest.mockResolvedValue(page([]));

    await fetchCurrentUserSurveyResponses(req, proxy as unknown as MicroserviceProxyService);

    expect(proxy.proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ filters_or: ['username:someuser'] })
    );
  });

  it('OR-matches email and username together when both resolve', async () => {
    getUsernameFromAuth.mockResolvedValue('auth0|someuser');
    getEffectiveEmail.mockReturnValue('invitee@example.com');
    const proxy = mockProxy();
    proxy.proxyRequest.mockResolvedValue(page([]));

    await fetchCurrentUserSurveyResponses(req, proxy as unknown as MicroserviceProxyService);

    expect(proxy.proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ filters_or: ['email:invitee@example.com', 'username:someuser'] })
    );
  });

  it('keeps only unanswered rows — populated response_datetime counts as answered; empty or whitespace counts as unanswered', async () => {
    getUsernameFromAuth.mockResolvedValue('someuser');
    getEffectiveEmail.mockReturnValue('invitee@example.com');
    const proxy = mockProxy();
    proxy.proxyRequest.mockResolvedValue(
      page([
        responseRow({ uid: 'unanswered-1', response_datetime: '' }),
        responseRow({ uid: 'answered', response_datetime: '2026-09-01T12:00:00Z' }),
        responseRow({ uid: 'unanswered-2' }),
        responseRow({ uid: 'whitespace', response_datetime: '   ' }),
      ])
    );

    const rows = await fetchCurrentUserSurveyResponses(req, proxy as unknown as MicroserviceProxyService);

    expect(rows.map((r) => r.uid).sort()).toEqual(['unanswered-1', 'unanswered-2', 'whitespace']);
  });

  it('merges caller tags (e.g. project scoping) alongside the identity filters_or', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    getEffectiveEmail.mockReturnValue('invitee@example.com');
    const proxy = mockProxy();
    proxy.proxyRequest.mockResolvedValue(page([]));

    await fetchCurrentUserSurveyResponses(req, proxy as unknown as MicroserviceProxyService, { tags: ['project_uid:proj-1'] });

    expect(proxy.proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ tags: ['project_uid:proj-1'], filters_or: ['email:invitee@example.com'] })
    );
  });

  it('aggregates multiple pages through the real paginator, forwarding page_token', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    getEffectiveEmail.mockReturnValue('invitee@example.com');
    const proxy = mockProxy();
    proxy.proxyRequest.mockResolvedValueOnce(page([responseRow({ uid: 'page-1' })], 'token-2')).mockResolvedValueOnce(page([responseRow({ uid: 'page-2' })]));

    const rows = await fetchCurrentUserSurveyResponses(req, proxy as unknown as MicroserviceProxyService);

    expect(rows.map((r) => r.uid)).toEqual(['page-1', 'page-2']);
    expect(proxy.proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', expect.objectContaining({ page_token: 'token-2' }));
  });

  it('throws on a mid-pagination failure when failOnPartial is set', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    getEffectiveEmail.mockReturnValue('invitee@example.com');
    const proxy = mockProxy();
    proxy.proxyRequest.mockResolvedValueOnce(page([responseRow({ uid: 'page-1' })], 'token-2')).mockRejectedValueOnce(new Error('boom'));

    await expect(fetchCurrentUserSurveyResponses(req, proxy as unknown as MicroserviceProxyService, { failOnPartial: true })).rejects.toThrow('boom');
  });

  it('returns the first page on a mid-pagination failure by default (partial results)', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    getEffectiveEmail.mockReturnValue('invitee@example.com');
    const proxy = mockProxy();
    proxy.proxyRequest.mockResolvedValueOnce(page([responseRow({ uid: 'page-1' })], 'token-2')).mockRejectedValueOnce(new Error('boom'));

    const rows = await fetchCurrentUserSurveyResponses(req, proxy as unknown as MicroserviceProxyService);

    expect(rows.map((r) => r.uid)).toEqual(['page-1']);
  });
});
