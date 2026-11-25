// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as campaigns.route.spec.ts: the import graph reaches Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_CODE,
  LINKEDIN_AUDIENCES_RESTRICTED_CODE,
  LINKEDIN_CONVERSIONS_ACCESS_UNAVAILABLE_CODE,
  LINKEDIN_CONVERSIONS_RESTRICTED_CODE,
  LINKEDIN_LEAD_FORMS_ACCESS_UNAVAILABLE_CODE,
} from '@lfx-one/shared/constants';

/**
 * Router-level coverage for the LinkedIn targeting lookups (#5764 rows 8–11), wiring only (the mapping rules are
 * `campaign-linkedin-targeting-lookup.utils.ts`'s, tested in shared). The audience read must be answered by its own
 * guard and the controller's strict `global_marketing_ops` check, NOT by the blanket `router.use(requireCampaignManager)`,
 * which is stubbed here to refuse every request; the targeting search sits behind that blanket guard, so it is let
 * through for the search tests.
 */

const { svcList, svcSearch, svcConversions, svcLeadForms, isServerFeatureEnabled, checkProjectGlobalMarketingOpsStrict, blanketGuard, blanketAdmits } =
  vi.hoisted(() => ({
    svcList: vi.fn(),
    svcSearch: vi.fn(),
    svcConversions: vi.fn(),
    svcLeadForms: vi.fn(),
    blanketAdmits: { current: false },
    isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => true),
    checkProjectGlobalMarketingOpsStrict: vi.fn<(req: unknown, slug: string) => Promise<boolean>>(async () => true),
    blanketGuard: vi.fn(),
  }));

vi.mock('../middleware/require-marketing-access.middleware', async () => {
  const { AuthorizationError } = await import('../errors');
  return {
    requireCampaignManager: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      blanketGuard(req.path);
      if (blanketAdmits.current) {
        next();
        return;
      }
      next(new AuthorizationError('campaign_manager access required for this resource', { code: 'MARKETING_ACCESS_REQUIRED', path: req.path }));
    },
    requireGoogleMonitorAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireGoogleConversionActionsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireGoogleUserListsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireGoogleAudiencesAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireMetaCustomAudiencesAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireMetaLeadFormsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireLinkedInAudiencesAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireLinkedInConversionsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    requireLinkedInLeadFormsAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  };
});
vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public listLinkedInAudiences = svcList;
      public searchLinkedInTargetingEntities = svcSearch;
      public listLinkedInConversions = svcConversions;
      public listLinkedInLeadForms = svcLeadForms;
    },
  };
});
vi.mock('../helpers/server-feature-flag.helper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/server-feature-flag.helper')>();
  return { ...actual, isServerFeatureEnabled };
});
vi.mock('../services/campaign-proxy.service', () => ({ CampaignProxyService: class {} }));
vi.mock('../services/campaign-metrics.service', () => ({
  CampaignMetricsService: class {},
  LinkedInMetricsService: class {},
  RedditMetricsService: class {},
  MetaMetricsService: class {},
}));
vi.mock('../services/linkedin-ads.service', () => ({ getLinkedInConfig: () => ({ accounts: [], targetingProfiles: [] }) }));
vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: {
    checkRootWriter: vi.fn(async () => false),
    checkRootCampaignManager: vi.fn(async () => false),
    checkProjectGlobalMarketingOpsStrict,
  },
}));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));
vi.mock('../controllers/audience-builder.controller', () => ({ AudienceBuilderController: class {} }));
vi.mock('../controllers/campaign-optimize.controller', () => ({ CampaignOptimizeController: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    getLastOperation: vi.fn(() => undefined),
  },
}));

const campaignsRouter = (await import('./campaigns.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/campaigns', campaignsRouter);
  app.use(apiErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  isServerFeatureEnabled.mockImplementation(() => true);
  checkProjectGlobalMarketingOpsStrict.mockResolvedValue(true);
  blanketAdmits.current = false;
});

const getAudiences = (): Promise<Response> => fetch(`${baseUrl}/api/campaigns/linkedin/audiences?project=tlf`);

describe('GET /api/campaigns/linkedin/audiences', () => {
  it("answers an access-check outage with the controller's coded 503, not the blanket guard's 403", async () => {
    checkProjectGlobalMarketingOpsStrict.mockRejectedValueOnce(new Error('access-check unavailable'));

    const res = await getAudiences();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_CODE });
    expect(blanketGuard).not.toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });

  it('answers a caller without global_marketing_ops on the project with the coded 403', async () => {
    checkProjectGlobalMarketingOpsStrict.mockResolvedValueOnce(false);

    const res = await getAudiences();

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: LINKEDIN_AUDIENCES_RESTRICTED_CODE });
    expect(svcList).not.toHaveBeenCalled();
  });

  it('answers the mapped segments to a caller who holds it', async () => {
    svcList.mockResolvedValueOnce({
      account_id: '500000001',
      audiences: [{ id: '11', urn: 'urn:li:adSegment:11', name: 'Contacts', type: 'BULK', status: 'READY', facet: 'audienceMatchingSegments' }],
      audience_count: 1,
      truncated: false,
    });

    const res = await fetch(`${baseUrl}/api/campaigns/linkedin/audiences?project=tlf&accountId=500000002`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accountId: '500000001',
      audiences: [
        { urn: 'urn:li:adSegment:11', name: 'Contacts', facet: 'audienceMatchingSegments', type: 'BULK', status: 'READY', approximateMemberCount: null },
      ],
    });
    expect(svcList).toHaveBeenCalledWith(expect.anything(), 'tlf', '500000002');
  });
});

// The conversion rule read (#5764 row 4) mirrors the audience read: its own guard, the controller's strict check.
describe('GET /api/campaigns/linkedin/conversions', () => {
  const getConversions = (): Promise<Response> => fetch(`${baseUrl}/api/campaigns/linkedin/conversions?project=tlf`);

  it("answers an access-check outage with the controller's coded 503, not the blanket guard's 403", async () => {
    checkProjectGlobalMarketingOpsStrict.mockRejectedValueOnce(new Error('access-check unavailable'));

    const res = await getConversions();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: LINKEDIN_CONVERSIONS_ACCESS_UNAVAILABLE_CODE });
    expect(blanketGuard).not.toHaveBeenCalled();
    expect(svcConversions).not.toHaveBeenCalled();
  });

  it('answers a caller without global_marketing_ops on the project with the coded 403', async () => {
    checkProjectGlobalMarketingOpsStrict.mockResolvedValueOnce(false);

    const res = await getConversions();

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: LINKEDIN_CONVERSIONS_RESTRICTED_CODE });
    expect(svcConversions).not.toHaveBeenCalled();
  });

  it('answers the mapped rules to a caller who holds it', async () => {
    svcConversions.mockResolvedValueOnce({
      account_id: '500000001',
      conversions: [
        { id: '104012', urn: 'urn:lla:llaPartnerConversion:104012', name: 'Registration', type: 'REGISTRATION', enabled: true },
        { id: '104013', urn: 'urn:lla:llaPartnerConversion:104013', name: 'Old', type: 'LEAD', enabled: false },
      ],
      conversion_count: 2,
    });

    const res = await fetch(`${baseUrl}/api/campaigns/linkedin/conversions?project=tlf&accountId=500000002`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accountId: '500000001', conversions: [{ id: '104012', name: 'Registration', type: 'REGISTRATION' }] });
    expect(svcConversions).toHaveBeenCalledWith(expect.anything(), 'tlf', '500000002');

    // A malformed account id is refused before any upstream call.
    svcConversions.mockClear();
    expect((await fetch(`${baseUrl}/api/campaigns/linkedin/conversions?project=tlf&accountId=act_1`)).status).toBe(400);
    expect(svcConversions).not.toHaveBeenCalled();
  });

  it('fails an unreadable rule list with a 502 rather than an empty list', async () => {
    svcConversions.mockResolvedValueOnce({ account_id: '500000001' });

    expect((await getConversions()).status).toBe(502);
    expect(svcConversions).toHaveBeenCalledTimes(1);
  });

  it('answers 404 while LinkedIn conversions are off, with no upstream call', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => flag !== 'LFX_CUTOVER_CAMPAIGN_SERVICE_LINKEDIN_CONVERSIONS');

    expect((await getConversions()).status).toBe(404);
    expect(svcConversions).not.toHaveBeenCalled();
  });
});

// The lead form read (campaign-service#664) mirrors the conversion rule read: its own guard, the controller's strict check.
describe('GET /api/campaigns/linkedin/lead-forms', () => {
  const getForms = (query = ''): Promise<Response> => fetch(`${baseUrl}/api/campaigns/linkedin/lead-forms?project=tlf${query}`);

  it("answers an access-check outage with the controller's coded 503, not the blanket guard's 403", async () => {
    checkProjectGlobalMarketingOpsStrict.mockRejectedValueOnce(new Error('access-check unavailable'));

    const res = await getForms();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: LINKEDIN_LEAD_FORMS_ACCESS_UNAVAILABLE_CODE });
    expect(blanketGuard).not.toHaveBeenCalled();
    expect(svcLeadForms).not.toHaveBeenCalled();
  });

  it('answers the mapped forms on the account named, and refuses a malformed account before any upstream call', async () => {
    svcLeadForms.mockResolvedValueOnce({
      account_id: '500000002',
      forms: [
        { id: '11', urn: 'urn:li:adForm:11', name: 'CFP interest', state: 'DRAFT' },
        { id: '12', urn: 'urn:li:adForm:12', name: 'Old', state: 'ARCHIVED' },
      ],
      form_count: 2,
    });

    const res = await getForms('&accountId=500000002');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accountId: '500000002', forms: [{ id: '11', name: 'CFP interest', state: 'DRAFT' }] });
    expect(svcLeadForms).toHaveBeenCalledWith(expect.anything(), 'tlf', '500000002');

    svcLeadForms.mockClear();
    expect((await getForms('&accountId=act_1')).status).toBe(400);
    expect(svcLeadForms).not.toHaveBeenCalled();
  });

  it('answers 404 while LinkedIn lead gen is off, with no upstream call', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => flag !== 'LFX_CUTOVER_CAMPAIGN_SERVICE_LINKEDIN_LEAD_GEN');

    expect((await getForms()).status).toBe(404);
    expect(svcLeadForms).not.toHaveBeenCalled();
  });
});

describe('GET /api/campaigns/linkedin/targeting-entities', () => {
  beforeEach(() => {
    blanketAdmits.current = true;
  });

  it('searches the facet and offers only the values it accepts', async () => {
    svcSearch.mockResolvedValueOnce({
      facet: 'skills',
      entities: [
        { urn: 'urn:li:skill:17', name: 'Kubernetes' },
        { urn: 'urn:li:title:1', name: 'Wrong facet' },
      ],
      entity_count: 2,
    });

    const res = await fetch(`${baseUrl}/api/campaigns/linkedin/targeting-entities?project=tlf&facet=skills&q=kube`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ facet: 'skills', entities: [{ urn: 'urn:li:skill:17', name: 'Kubernetes' }] });
    expect(svcSearch).toHaveBeenCalledWith(expect.anything(), 'tlf', 'skills', 'kube');
  });

  it('is refused by the blanket campaign-manager guard, with no upstream call', async () => {
    blanketAdmits.current = false;

    const res = await fetch(`${baseUrl}/api/campaigns/linkedin/targeting-entities?project=tlf&facet=skills&q=kube`);

    expect(res.status).toBe(403);
    expect(svcSearch).not.toHaveBeenCalled();
  });

  it('refuses a facet it does not search, and answers 404 while targeting is off, with no upstream call', async () => {
    expect((await fetch(`${baseUrl}/api/campaigns/linkedin/targeting-entities?project=tlf&facet=locations&q=kube`)).status).toBe(400);
    isServerFeatureEnabled.mockImplementation((flag) => flag !== 'LFX_CUTOVER_CAMPAIGN_SERVICE_LINKEDIN_TARGETING');
    expect((await fetch(`${baseUrl}/api/campaigns/linkedin/targeting-entities?project=tlf&facet=skills&q=kube`)).status).toBe(404);
    expect(svcSearch).not.toHaveBeenCalled();
  });

  it('maps a LinkedIn throttle to the coded 503 and an unreadable body to a 502', async () => {
    const { MicroserviceError } = await import('../errors');
    svcSearch.mockRejectedValueOnce(new MicroserviceError('throttled', 503, 'SERVICE_UNAVAILABLE', {}));
    svcSearch.mockResolvedValueOnce({ facet: 'skills' });
    const search = (): Promise<Response> => fetch(`${baseUrl}/api/campaigns/linkedin/targeting-entities?project=tlf&facet=skills&q=kube`);

    const throttled = await search();
    expect(throttled.status).toBe(503);
    expect(await throttled.json()).toMatchObject({ code: 'LINKEDIN_TARGETING_SEARCH_UNAVAILABLE' });
    expect((await search()).status).toBe(502);
  });

  it('refuses a short query and a malformed account id with a 400, with no upstream call', async () => {
    expect((await fetch(`${baseUrl}/api/campaigns/linkedin/targeting-entities?project=tlf&facet=skills&q=k`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/campaigns/linkedin/audiences?project=tlf&accountId=act_1`)).status).toBe(400);
    expect(svcSearch).not.toHaveBeenCalled();
    expect(svcList).not.toHaveBeenCalled();
  });
});
