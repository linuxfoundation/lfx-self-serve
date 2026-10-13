// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACCESS_CHECK_BATCH_SIZE } from '@lfx-one/shared/constants';
import type { Survey, SurveyCommittee } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveUsernameMock, getEffectiveNameMock, resolveUserIdentityMock, proxyRequestMock, fetchAllQueryResourcesMock, enrichWithProjectDataMock } =
  vi.hoisted(() => ({
    getEffectiveUsernameMock: vi.fn(),
    getEffectiveNameMock: vi.fn(),
    resolveUserIdentityMock: vi.fn(),
    proxyRequestMock: vi.fn(),
    fetchAllQueryResourcesMock: vi.fn(),
    enrichWithProjectDataMock: vi.fn(),
  }));

vi.mock('../utils/auth-helper', () => ({
  getEffectiveUsername: getEffectiveUsernameMock,
  getEffectiveName: getEffectiveNameMock,
  resolveUserIdentity: resolveUserIdentityMock,
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: vi.fn().mockImplementation(() => ({ proxyRequest: proxyRequestMock })),
}));
// The shared utils barrel pulls in @angular/forms, which cannot load in a plain Node runtime.
vi.mock('@lfx-one/shared/utils', async () => {
  const { getSurveyDisplayStatus } = await import('../../../../../packages/shared/src/utils/survey.utils');
  return { getSurveyDisplayStatus };
});
vi.mock('../helpers/entity-project-enrichment.helper', () => ({ fetchEntityProject: vi.fn(), toEntityProjectFields: vi.fn() }));
vi.mock('../helpers/query-service.helper', () => ({ fetchAllQueryResources: fetchAllQueryResourcesMock }));
vi.mock('./etag.service', () => ({ ETagService: vi.fn() }));
vi.mock('./project.service', () => ({
  ProjectService: vi.fn().mockImplementation(() => ({ enrichWithProjectData: enrichWithProjectDataMock, getProjectById: vi.fn() })),
}));
vi.mock('../helpers/poll-endpoint.helper', () => ({ pollEndpoint: vi.fn().mockResolvedValue(true) }));
vi.mock('./logger.service', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    startOperation: vi.fn().mockReturnValue(0),
    success: vi.fn(),
    sanitize: vi.fn((v: unknown) => v),
  },
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

function surveyRow(uid: string, committeeUids: string[], overrides: Partial<Survey> = {}): Survey {
  return {
    uid,
    survey_title: uid,
    survey_status: 'draft',
    survey_cutoff_date: null,
    committees: committeeUids.map((committeeUid) => ({ committee_uid: committeeUid, project_uid: 'project-1' }) as SurveyCommittee),
    ...overrides,
  } as Survey;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('SurveyService.getSurveys — caller-scoped committee writer grants', () => {
  let service: SurveyService;
  const req = { path: '/api/surveys', bearerToken: 'caller-token' } as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    getEffectiveUsernameMock.mockReset();
    getEffectiveNameMock.mockReset();
    proxyRequestMock.mockReset();
    resolveUserIdentityMock.mockReset().mockResolvedValue({});
    fetchAllQueryResourcesMock.mockReset().mockResolvedValue([]);
    enrichWithProjectDataMock.mockReset().mockImplementation(async (_req: Request, surveys: Survey[]) => surveys);
    service = new SurveyService();
  });

  it('grants a draft through its secondary committee without granting denied or unrelated rows', async () => {
    fetchAllQueryResourcesMock.mockResolvedValue([
      surveyRow('secondary-grant', ['primary-denied', 'secondary-writer']),
      surveyRow('denied', ['primary-denied'], { committee_writer: true }),
      surveyRow('unrelated', ['other-committee'], { committee_writer: true }),
    ]);
    proxyRequestMock.mockResolvedValue({
      results: [
        'committee:secondary-writer#writer@user:caller\ttrue',
        'committee:primary-denied#writer@user:caller\tfalse',
        'committee:other-committee#viewer@user:caller\ttrue',
        'committee:not-associated#writer@user:caller\ttrue',
      ],
    });

    const rows = await service.getSurveys(req);

    expect(rows.map((row) => row.committee_writer)).toEqual([true, false, false]);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    expect(proxyRequestMock.mock.calls[0][2]).toBe('/access-check');
  });

  it('deduplicates committee checks across rows and skips empty or blank associations', async () => {
    fetchAllQueryResourcesMock.mockResolvedValue([
      surveyRow('duplicates', ['shared', 'shared', '', '   ']),
      surveyRow('shared-row', ['shared']),
      surveyRow('empty', [], { committee_writer: true }),
      surveyRow('blank', ['', '\t'], { committee_writer: true }),
    ]);
    proxyRequestMock.mockResolvedValue({ results: ['committee:shared#writer@user:caller\ttrue'] });

    const rows = await service.getSurveys(req);

    expect(rows.map((row) => row.committee_writer)).toEqual([true, true, false, false]);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    expect(proxyRequestMock.mock.calls[0][5].requests).toEqual(['committee:shared#writer']);
  });

  it('checks only effective drafts, respecting status case normalization and the closed sentinel', async () => {
    fetchAllQueryResourcesMock.mockResolvedValue([
      surveyRow('uppercase-draft', ['draft-committee'], { survey_status: 'DRAFT' }),
      surveyRow('open', ['open-committee'], { survey_status: 'OPEN', committee_writer: true }),
      surveyRow('sent', ['sent-committee'], { survey_status: 'SENT', survey_cutoff_date: '2999-01-01', committee_writer: true }),
      surveyRow('closed', ['closed-committee'], { survey_status: 'closed', committee_writer: true }),
      surveyRow('closed-sentinel', ['sentinel-committee'], { response_status: 'CLOSED', committee_writer: true }),
      surveyRow('unknown', ['unknown-committee'], { survey_status: 'unexpected', committee_writer: true }),
    ]);
    proxyRequestMock.mockResolvedValue({ results: ['committee:draft-committee#writer@user:caller\ttrue'] });

    const rows = await service.getSurveys(req);

    expect(rows.map((row) => row.committee_writer)).toEqual([true, false, false, false, false, false]);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    expect(proxyRequestMock.mock.calls[0][5].requests).toEqual(['committee:draft-committee#writer']);
  });

  it('returns readable rows without authorization requests when there are no eligible committee UIDs', async () => {
    fetchAllQueryResourcesMock.mockResolvedValue([
      surveyRow('empty-draft', [], { committee_writer: true }),
      surveyRow('closed', ['unused'], { response_status: 'closed', committee_writer: true }),
    ]);

    const rows = await service.getSurveys(req);

    expect(rows.map((row) => [row.uid, row.committee_writer])).toEqual([
      ['empty-draft', false],
      ['closed', false],
    ]);
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('bounds more than 100 unique committee checks to sequential batches with one request in flight', async () => {
    const committeeCount = ACCESS_CHECK_BATCH_SIZE * 2 + 1;
    fetchAllQueryResourcesMock.mockResolvedValue(Array.from({ length: committeeCount }, (_, index) => surveyRow(`survey-${index}`, [`committee-${index}`])));
    const first = deferred<{ results: string[] }>();
    const second = deferred<{ results: string[] }>();
    const third = deferred<{ results: string[] }>();
    const started = [deferred<void>(), deferred<void>(), deferred<void>()];
    const pending = [first, second, third];
    let inFlight = 0;
    let maxInFlight = 0;
    let nextBatch = 0;
    proxyRequestMock.mockImplementation(() => {
      const index = nextBatch++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      started[index].resolve();
      return pending[index].promise.finally(() => inFlight--);
    });

    const result = service.getSurveys(req);
    await started[0].promise;
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    first.resolve({ results: [`committee:committee-${ACCESS_CHECK_BATCH_SIZE - 1}#writer@user:caller\ttrue`] });
    await started[1].promise;
    expect(proxyRequestMock).toHaveBeenCalledTimes(2);
    second.resolve({ results: [] });
    await started[2].promise;
    expect(proxyRequestMock).toHaveBeenCalledTimes(3);
    third.resolve({ results: [`committee:committee-${committeeCount - 1}#writer@user:caller\ttrue`] });
    const rows = await result;

    expect(maxInFlight).toBe(1);
    expect(proxyRequestMock.mock.calls.map((call) => call[5].requests.length)).toEqual([ACCESS_CHECK_BATCH_SIZE, ACCESS_CHECK_BATCH_SIZE, 1]);
    expect(rows.filter((row) => row.committee_writer).map((row) => row.uid)).toEqual([`survey-${ACCESS_CHECK_BATCH_SIZE - 1}`, `survey-${committeeCount - 1}`]);
    expect(rows).toHaveLength(committeeCount);
  });

  it('fails closed for a failed batch while continuing to resolve later committees and keeping every row readable', async () => {
    const committeeCount = ACCESS_CHECK_BATCH_SIZE + 1;
    fetchAllQueryResourcesMock.mockResolvedValue(
      Array.from({ length: committeeCount }, (_, index) => surveyRow(`survey-${index}`, [`committee-${index}`], { committee_writer: true }))
    );
    proxyRequestMock.mockRejectedValueOnce(new Error('access service unavailable')).mockResolvedValueOnce({
      results: [`committee:committee-${ACCESS_CHECK_BATCH_SIZE}#writer@user:caller\ttrue`],
    });

    const rows = await service.getSurveys(req);

    expect(rows).toHaveLength(committeeCount);
    expect(rows.slice(0, ACCESS_CHECK_BATCH_SIZE).every((row) => row.committee_writer === false)).toBe(true);
    expect(rows[ACCESS_CHECK_BATCH_SIZE].committee_writer).toBe(true);
    expect(proxyRequestMock).toHaveBeenCalledTimes(2);
  });

  it('never grants unanswered or malformed access results even when the index supplied a grant', async () => {
    fetchAllQueryResourcesMock.mockResolvedValue([
      surveyRow('missing', ['missing'], { committee_writer: true }),
      surveyRow('malformed', ['malformed'], { committee_writer: true }),
    ]);
    proxyRequestMock.mockResolvedValue({ results: ['committee:malformed#writer@user:caller\tunknown', 'invalid'] });

    const rows = await service.getSurveys(req);

    expect(rows.map((row) => row.committee_writer)).toEqual([false, false]);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
  });

  it('resolves grants for each caller independently on the same service and indexed rows', async () => {
    const indexed = [surveyRow('shared-row', ['shared'], { committee_writer: true })];
    const deniedReq = { path: '/api/surveys', bearerToken: 'denied-token' } as Request;
    fetchAllQueryResourcesMock.mockResolvedValue(indexed);
    proxyRequestMock.mockImplementation(async (request: Request) => ({
      results: [`committee:shared#writer@user:caller\t${request === req ? 'true' : 'false'}`],
    }));

    const grantedRows = await service.getSurveys(req);
    const deniedRows = await service.getSurveys(deniedReq);

    expect(grantedRows[0].committee_writer).toBe(true);
    expect(deniedRows[0].committee_writer).toBe(false);
    expect(proxyRequestMock).toHaveBeenCalledTimes(2);
  });

  it('preserves the response-status join and owning project UID without granting a closed-sentinel row', async () => {
    resolveUserIdentityMock.mockResolvedValue({ username: 'caller' });
    fetchAllQueryResourcesMock
      .mockResolvedValueOnce([surveyRow('responded-draft', ['writer']), surveyRow('closed-sentinel', ['writer'], { response_status: 'CLOSED' })])
      .mockResolvedValueOnce([
        { survey_uid: 'responded-draft', response_datetime: '2026-01-01T00:00:00Z' },
        { survey_uid: 'closed-sentinel', response_datetime: '2026-01-01T00:00:00Z' },
      ]);
    proxyRequestMock.mockResolvedValue({ results: ['committee:writer#writer@user:caller\ttrue'] });

    const rows = await service.getSurveys(req);

    expect(rows[0]).toMatchObject({
      committee_writer: true,
      response_status: 'responded',
      project_uid: 'project-1',
    });
    expect(rows[1].committee_writer).toBe(false);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
  });
});
