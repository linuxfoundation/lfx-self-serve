// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The utils barrel pulls in `@angular/forms`, which can't load in plain Node, so the badge helpers
// are re-exported through the mock from their real source module.
vi.mock('@lfx-one/shared/utils', async () => await vi.importActual('../../../../../packages/shared/src/utils/badge.utils'));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { CredlyApiResponse, CredlyBadgeEntry } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { CredlyService } from './credly.service';
import { logger } from './logger.service';

const API_URL = 'https://credly.example/v1';
const PRIMARY_EMAIL = 'user@example.com';
const SECONDARY_EMAIL = 'alt@acme.example';
const CREDLY_ENV_KEYS = ['CREDLY_API_URL', 'CREDLY_ORG_ID', 'CREDLY_API_TOKEN', 'CREDLY_CACHE_TTL_MS'] as const;

const req = {} as Request;

function buildEntry(overrides: Partial<CredlyBadgeEntry> = {}): CredlyBadgeEntry {
  return {
    id: 'badge-1',
    issued_at: '2026-01-15T00:00:00Z',
    issued_at_date: '2026-01-15',
    expires_at: null,
    expires_at_date: null,
    state: 'accepted',
    public: true,
    badge_url: 'https://credly.example/badges/badge-1',
    accept_badge_url: null,
    recipient_email: PRIMARY_EMAIL,
    image_url: 'https://credly.example/images/badge-1.png',
    issued_to: 'Test User',
    issued_to_first_name: 'Test',
    issued_to_middle_name: null,
    issued_to_last_name: 'User',
    issuer_earner_id: null,
    user: null,
    issuer: null,
    badge_template: {
      id: 'template-1',
      name: 'Example Certified Contributor',
      description: 'Synthetic badge template',
      image_url: 'https://credly.example/images/template-1.png',
      url: 'https://credly.example/templates/template-1',
      type_category: 'Certification',
      level: null,
      skills: [],
      reporting_tags: [],
    },
    ...overrides,
  };
}

function okResponse(entries: CredlyBadgeEntry[], nextPageUrl: string | null = null): Response {
  const body: CredlyApiResponse = {
    data: entries,
    metadata: {
      count: entries.length,
      current_page: 1,
      total_count: entries.length,
      total_pages: 1,
      per: 50,
      previous_page_url: null,
      next_page_url: nextPageUrl,
    },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(status: number): Response {
  return new Response('{}', { status });
}

/** A trusted second-page URL that still carries the email's recipient filter, so `stubFetch` can route it. */
function secondPageUrl(email: string): string {
  return `${API_URL}/organizations/org-1/badges?filter=${encodeURIComponent(`recipient_email::${email}|state::accepted,pending`)}&page=2`;
}

/** Answer successive requests for one email with the given responses, cycling back to the first. */
function sequence(...responses: (() => Response)[]): () => Response {
  let call = 0;
  return () => responses[call++ % responses.length]();
}

/** Stub `fetch`, routing each Credly request to a per-email handler by its recipient filter. */
function stubFetch(handlers: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (url: string) => {
    const decoded = decodeURIComponent(String(url));
    const email = Object.keys(handlers).find((key) => decoded.includes(`recipient_email::${key}|`));
    if (!email) throw new Error(`Unexpected Credly request: ${decoded}`);
    return handlers[email]();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('CredlyService.getBadgesForEmails', () => {
  const originalEnv: Partial<Record<(typeof CREDLY_ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of CREDLY_ENV_KEYS) originalEnv[key] = process.env[key];
    process.env['CREDLY_API_URL'] = API_URL;
    process.env['CREDLY_ORG_ID'] = 'org-1';
    process.env['CREDLY_API_TOKEN'] = 'test-token';
    process.env['CREDLY_CACHE_TTL_MS'] = '60000';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of CREDLY_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('rejects with 503 CREDLY_NOT_CONFIGURED when Credly env vars are missing', async () => {
    delete process.env['CREDLY_API_TOKEN'];
    const fetchMock = stubFetch({});

    const error = await new CredlyService().getBadgesForEmails(req, [PRIMARY_EMAIL]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error).toMatchObject({ statusCode: 503, code: 'CREDLY_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects with 502 CREDLY_UNAVAILABLE when every email lookup returns an error, and does not cache', async () => {
    const fetchMock = stubFetch({ [PRIMARY_EMAIL]: () => errorResponse(500), [SECONDARY_EMAIL]: () => errorResponse(500) });
    const service = new CredlyService();

    const error = await service.getBadgesForEmails(req, [PRIMARY_EMAIL, SECONDARY_EMAIL]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error).toMatchObject({ statusCode: 502, code: 'CREDLY_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await service.getBadgesForEmails(req, [PRIMARY_EMAIL, SECONDARY_EMAIL]).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rejects with 502 CREDLY_UNAVAILABLE when every email lookup throws', async () => {
    stubFetch({
      [PRIMARY_EMAIL]: () => {
        throw new TypeError('fetch failed');
      },
    });

    const error = await new CredlyService().getBadgesForEmails(req, [PRIMARY_EMAIL]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error).toMatchObject({ statusCode: 502, code: 'CREDLY_UNAVAILABLE' });
  });

  it('resolves an empty list and caches it when every lookup succeeds with no badges', async () => {
    const fetchMock = stubFetch({ [PRIMARY_EMAIL]: () => okResponse([]) });
    const service = new CredlyService();

    await expect(service.getBadgesForEmails(req, [PRIMARY_EMAIL])).resolves.toEqual([]);
    await expect(service.getBadgesForEmails(req, [PRIMARY_EMAIL])).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the loaded badges without caching when some email lookups fail', async () => {
    const fetchMock = stubFetch({ [PRIMARY_EMAIL]: () => okResponse([buildEntry()]), [SECONDARY_EMAIL]: () => errorResponse(500) });
    const service = new CredlyService();

    const badges = await service.getBadgesForEmails(req, [PRIMARY_EMAIL, SECONDARY_EMAIL]);

    expect(badges.map((b) => b.id)).toEqual(['badge-1']);
    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'get_badges_for_emails',
      'Partial Credly failure; returning collected badges without caching',
      expect.objectContaining({ email_count: 2, failed_count: 1, badge_count: 1 })
    );

    await service.getBadgesForEmails(req, [PRIMARY_EMAIL, SECONDARY_EMAIL]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rejects with 502 CREDLY_UNAVAILABLE when the only email fails partway through pagination', async () => {
    const fetchMock = stubFetch({
      [PRIMARY_EMAIL]: sequence(
        () => okResponse([buildEntry()], secondPageUrl(PRIMARY_EMAIL)),
        () => errorResponse(500)
      ),
    });

    const error = await new CredlyService().getBadgesForEmails(req, [PRIMARY_EMAIL]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error).toMatchObject({ statusCode: 502, code: 'CREDLY_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps earlier pages of an email that fails partway through pagination, without caching', async () => {
    const fetchMock = stubFetch({
      [PRIMARY_EMAIL]: sequence(
        () => okResponse([buildEntry()], secondPageUrl(PRIMARY_EMAIL)),
        () => errorResponse(500)
      ),
      [SECONDARY_EMAIL]: () => okResponse([buildEntry({ id: 'badge-3', recipient_email: SECONDARY_EMAIL, issued_at_date: '2026-03-01' })]),
    });
    const service = new CredlyService();

    const badges = await service.getBadgesForEmails(req, [PRIMARY_EMAIL, SECONDARY_EMAIL]);

    expect(badges.map((b) => b.id)).toEqual(['badge-3', 'badge-1']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'get_badges_for_emails',
      'Partial Credly failure; returning collected badges without caching',
      expect.objectContaining({ email_count: 2, failed_count: 1, badge_count: 2 })
    );

    await service.getBadgesForEmails(req, [PRIMARY_EMAIL, SECONDARY_EMAIL]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('drops entries missing required fields and logs the dropped count', async () => {
    const incomplete = buildEntry({ id: 'badge-2', issued_to_first_name: '', issued_to_last_name: '' });
    stubFetch({ [PRIMARY_EMAIL]: () => okResponse([buildEntry(), incomplete]) });

    const badges = await new CredlyService().getBadgesForEmails(req, [PRIMARY_EMAIL]);

    expect(badges.map((b) => b.id)).toEqual(['badge-1']);
    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'get_badges_for_emails',
      'Dropped Credly badge entries missing required fields',
      expect.objectContaining({ deduplicated_count: 2, valid_count: 1, dropped_count: 1 })
    );
  });

  it('maps and caches badges when every lookup succeeds', async () => {
    const fetchMock = stubFetch({
      [PRIMARY_EMAIL]: () => okResponse([buildEntry()]),
      [SECONDARY_EMAIL]: () => okResponse([buildEntry({ id: 'badge-3', recipient_email: SECONDARY_EMAIL, issued_at_date: '2026-03-01' })]),
    });
    const service = new CredlyService();

    const badges = await service.getBadgesForEmails(req, [PRIMARY_EMAIL, SECONDARY_EMAIL]);

    expect(badges.map((b) => b.id)).toEqual(['badge-3', 'badge-1']);
    expect(badges[0]).toMatchObject({ title: 'Example Certified Contributor', isPending: false });
    expect(logger.warning).not.toHaveBeenCalled();

    await expect(service.getBadgesForEmails(req, [SECONDARY_EMAIL, PRIMARY_EMAIL])).resolves.toEqual(badges);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
