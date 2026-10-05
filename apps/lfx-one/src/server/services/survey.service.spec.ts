// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveUsernameMock, getEffectiveNameMock, proxyRequestMock } = vi.hoisted(() => ({
  getEffectiveUsernameMock: vi.fn(),
  getEffectiveNameMock: vi.fn(),
  proxyRequestMock: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({
  getEffectiveUsername: getEffectiveUsernameMock,
  getEffectiveName: getEffectiveNameMock,
  resolveUserIdentity: vi.fn(),
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: vi.fn().mockImplementation(() => ({ proxyRequest: proxyRequestMock })),
}));
// The shared utils barrel pulls in @angular/forms, which cannot load in a plain Node runtime.
vi.mock('@lfx-one/shared/utils', () => ({ getSurveyDisplayStatus: vi.fn() }));
vi.mock('../helpers/entity-project-enrichment.helper', () => ({ fetchEntityProject: vi.fn(), toEntityProjectFields: vi.fn() }));
vi.mock('../helpers/query-service.helper', () => ({ fetchAllQueryResources: vi.fn() }));
vi.mock('./etag.service', () => ({ ETagService: vi.fn() }));
vi.mock('./project.service', () => ({ ProjectService: vi.fn() }));
vi.mock('../helpers/poll-endpoint.helper', () => ({ pollEndpoint: vi.fn().mockResolvedValue(true) }));
vi.mock('./logger.service', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), sanitize: vi.fn((v: unknown) => v) },
}));

import { SurveyService } from './survey.service';

describe('SurveyService.createSurvey — creator identity', () => {
  let service: SurveyService;
  const req = { path: '/api/surveys', oidc: { user: { name: 'Session User' } } } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SurveyService();
  });

  it('refuses to create a survey with a 401 when no LFID resolves', async () => {
    getEffectiveUsernameMock.mockReturnValue(null);

    await expect(service.createSurvey(req, { survey_title: 't' } as any)).rejects.toMatchObject({ statusCode: 401 });
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('stamps creator id, username and name from the effective identity', async () => {
    getEffectiveUsernameMock.mockReturnValue('target-lfid');
    getEffectiveNameMock.mockReturnValue('Target User');
    proxyRequestMock.mockResolvedValueOnce({ uid: 'survey-1' });

    await service.createSurvey(req, { survey_title: 't' } as any).catch(() => undefined);

    expect(proxyRequestMock.mock.calls[0][5]).toMatchObject({
      creator_id: 'target-lfid',
      creator_username: 'target-lfid',
      creator_name: 'Target User',
    });
  });
});
