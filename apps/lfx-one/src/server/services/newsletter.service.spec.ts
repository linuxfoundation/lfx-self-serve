// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeNewsletter, CommitteeNewsletterListResponse } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This app's vitest config resolves plain Node modules only — the `@lfx-one/shared/*` tsconfig
// path alias isn't wired here, so the constructed collaborators must be mocked (mirrors
// meeting.service.spec.ts). Only the my-newsletters composition is exercised; the client,
// committee, and project services are stubbed at the module boundary.
const { listCommitteeNewsletters, getMyCommittees, enrichWithProjectData } = vi.hoisted(() => ({
  listCommitteeNewsletters: vi.fn(),
  getMyCommittees: vi.fn(),
  enrichWithProjectData: vi.fn(),
}));

vi.mock('./newsletter-service.client', () => ({
  NewsletterServiceClient: class {
    public listCommitteeNewsletters = listCommitteeNewsletters;
  },
}));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getMyCommittees = getMyCommittees;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public enrichWithProjectData = enrichWithProjectData;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { NewsletterService } from './newsletter.service';

const req = {} as unknown as Request;

function newsletter(id: string, sentAt: string, committeeUids: string[]): CommitteeNewsletter {
  return { id, project_uid: `project-${id}`, subject: `Subject ${id}`, committee_uids: committeeUids, sent_at: sentAt };
}

function pageOf(newsletters: CommitteeNewsletter[], nextPageToken?: string): CommitteeNewsletterListResponse {
  return { newsletters, ...(nextPageToken && { next_page_token: nextPageToken }) };
}

describe('NewsletterService.getMyNewsletters', () => {
  let service: NewsletterService;

  beforeEach(() => {
    listCommitteeNewsletters.mockReset();
    getMyCommittees.mockReset();
    enrichWithProjectData.mockReset();
    // Default enrichment: passthrough — assertions on ordering/dedupe read the input.
    enrichWithProjectData.mockImplementation(async (_req: Request, items: CommitteeNewsletter[]) => items);
    service = new NewsletterService();
  });

  it('returns an empty list without upstream calls when the user has no committees', async () => {
    getMyCommittees.mockResolvedValue([]);

    const result = await service.getMyNewsletters(req);

    expect(result).toEqual([]);
    expect(listCommitteeNewsletters).not.toHaveBeenCalled();
    expect(enrichWithProjectData).not.toHaveBeenCalled();
  });

  it('dedupes newsletters reachable via multiple committees and sorts by sent_at descending', async () => {
    getMyCommittees.mockResolvedValue([{ uid: 'committee-a' }, { uid: 'committee-b' }]);
    const shared = newsletter('n1', '2026-07-01T12:00:00Z', ['committee-a', 'committee-b']);
    const older = newsletter('n2', '2026-06-01T12:00:00Z', ['committee-b']);
    const newest = newsletter('n3', '2026-07-15T12:00:00Z', ['committee-a']);
    listCommitteeNewsletters.mockImplementation(async (_req: Request, committeeUid: string) => {
      if (committeeUid === 'committee-a') return pageOf([shared, newest]);
      return pageOf([shared, older]);
    });

    const result = await service.getMyNewsletters(req);

    expect(result.map((n: CommitteeNewsletter) => n.id)).toEqual(['n3', 'n1', 'n2']);
    expect(listCommitteeNewsletters).toHaveBeenCalledTimes(2);
    expect(enrichWithProjectData).toHaveBeenCalledTimes(1);
  });

  it('follows next_page_token until the upstream list is exhausted', async () => {
    getMyCommittees.mockResolvedValue([{ uid: 'committee-a' }]);
    listCommitteeNewsletters
      .mockResolvedValueOnce(pageOf([newsletter('n1', '2026-07-01T12:00:00Z', ['committee-a'])], 'token-2'))
      .mockResolvedValueOnce(pageOf([newsletter('n2', '2026-06-01T12:00:00Z', ['committee-a'])]));

    const result = await service.getMyNewsletters(req);

    expect(result.map((n: CommitteeNewsletter) => n.id)).toEqual(['n1', 'n2']);
    expect(listCommitteeNewsletters).toHaveBeenCalledTimes(2);
    expect(listCommitteeNewsletters).toHaveBeenNthCalledWith(2, req, 'committee-a', 'token-2');
  });

  it('skips a failing committee and still returns the others', async () => {
    getMyCommittees.mockResolvedValue([{ uid: 'committee-a' }, { uid: 'committee-b' }]);
    listCommitteeNewsletters.mockImplementation(async (_req: Request, committeeUid: string) => {
      if (committeeUid === 'committee-a') throw new Error('403 from gateway');
      return pageOf([newsletter('n1', '2026-07-01T12:00:00Z', ['committee-b'])]);
    });

    const result = await service.getMyNewsletters(req);

    expect(result.map((n: CommitteeNewsletter) => n.id)).toEqual(['n1']);
  });

  it('queries each committee uid only once even with duplicate membership rows', async () => {
    getMyCommittees.mockResolvedValue([{ uid: 'committee-a' }, { uid: 'committee-a' }]);
    listCommitteeNewsletters.mockResolvedValue(pageOf([]));

    await service.getMyNewsletters(req);

    expect(listCommitteeNewsletters).toHaveBeenCalledTimes(1);
  });
});
