// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LensItemsQuery, Project, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));

// `@lfx-one/shared/enums` needs no stub: it resolves through the real barrel via the
// `@lfx-one/shared` alias in vitest.config.ts (no Angular-dependent code lives under enums/), so
// PROJECT_LENS_ALLOWED_STAGES and getFormationSubStageLabel compare against the real ProjectStage.
// `@lfx-one/shared/utils` still needs the stub below — that barrel re-exports Angular-dependent
// utils that throw at module-load time under this plain-Node Vitest environment.
// computeIsFoundation and getFormationSubStageLabel are pulled from the REAL implementation
// (not hand-copied), so stage-classification drift fails these tests too — see
// packages/shared/src/utils/project.utils.spec.ts for the exhaustive per-stage coverage.
// Deep-imports the single pure file rather than `vi.importActual('@lfx-one/shared/utils')`:
// the barrel re-exports Angular-dependent utils that throw at module-load time under this
// plain-Node Vitest environment.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/project.utils')>(
    '../../../../../packages/shared/src/utils/project.utils'
  );
  return {
    computeIsFoundation: actual.computeIsFoundation,
    getFormationSubStageLabel: actual.getFormationSubStageLabel,
  };
});
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { debug: vi.fn(), warning: vi.fn(), error: vi.fn(), startOperation: vi.fn(), success: vi.fn() },
}));

const { NavigationService } = await import('./navigation.service');

const req = {} as Request;

function pageOf(projects: Partial<Project>[]): QueryServiceResponse<Project> {
  return { resources: projects.map((p) => ({ type: 'project', id: `project:${p.uid}`, data: p as Project })), page_token: undefined };
}

/** The query object sent to the query-service `/query/resources` call. */
function lastQuerySent(): LensItemsQuery {
  return proxyRequest.mock.calls[proxyRequest.mock.calls.length - 1][4];
}

beforeEach(() => {
  proxyRequest.mockReset();
});

describe('NavigationService — toLensItem formationSubStage', () => {
  it.each([
    ['Formation - Exploratory', 'Exploratory'],
    ['Formation - Engaged', 'Engaged'],
    ['Formation - On Hold', 'On Hold'],
    ['Formation - Disengaged', 'Disengaged'],
    ['Formation - Confidential', 'Confidential'],
    ['Active', null],
    ['Archived', null],
    ['Prospect', null],
  ])('maps stage %s to formationSubStage %s', async (stage, expected) => {
    proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'p1', slug: 'p1', name: 'Project 1', stage: stage as Project['stage'], logo_url: '' }]));

    const response = await new NavigationService().getLensItems(req, { lens: 'project' });

    expect(response.items[0].formationSubStage).toBe(expected);
  });
});

describe('NavigationService — PROJECT_LENS_ALLOWED_STAGES', () => {
  it('includes Active plus every pre-launch Formation stage except Confidential', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([]));

    await new NavigationService().getLensItems(req, { lens: 'project' });

    expect(lastQuerySent().filters_or).toEqual(
      expect.arrayContaining([
        'stage:Active',
        'stage:Formation - Engaged',
        'stage:Formation - Exploratory',
        'stage:Formation - On Hold',
        'stage:Formation - Disengaged',
      ])
    );
    expect(lastQuerySent().filters_or).not.toContain('stage:Formation - Confidential');
  });

  it('re-injects a Confidential-stage selection via fetchItemsByUids despite being hidden from the general listing', async () => {
    // First page: normal query returns nothing — Confidential is excluded from the listing filter.
    proxyRequest.mockResolvedValueOnce(pageOf([]));
    // Second call: fetchItemsByUids' uid-scoped lookup returns the Confidential project.
    proxyRequest.mockResolvedValueOnce(
      pageOf([{ uid: 'confidential-1', slug: 'confidential-1', name: 'Secret', stage: 'Formation - Confidential' as Project['stage'] }])
    );

    const response = await new NavigationService().getLensItems(req, { lens: 'project', selectedUid: 'confidential-1' });

    expect(response.items).toHaveLength(1);
    expect(response.items[0].uid).toBe('confidential-1');
  });
});

describe('NavigationService — favoritedUids (GH-3453)', () => {
  it('injects a favorited item missing from the first browse page', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'p1', slug: 'p1', name: 'Project 1', stage: 'Active' as Project['stage'] }]));
    proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'fav-1', slug: 'fav-1', name: 'Favorite', stage: 'Active' as Project['stage'] }]));

    const response = await new NavigationService().getLensItems(req, { lens: 'project', favoritedUids: ['fav-1'] });

    expect(response.items.map((i) => i.uid)).toEqual(['p1', 'fav-1']);
  });

  it('does not re-fetch a favorite already present on the first page', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'fav-1', slug: 'fav-1', name: 'Favorite', stage: 'Active' as Project['stage'] }]));

    const response = await new NavigationService().getLensItems(req, { lens: 'project', favoritedUids: ['fav-1'] });

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(response.items.map((i) => i.uid)).toEqual(['fav-1']);
  });

  it('skips favorite injection while searching or paginating', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([]));
    await new NavigationService().getLensItems(req, { lens: 'project', favoritedUids: ['fav-1'], name: 'search term' });
    expect(proxyRequest).toHaveBeenCalledTimes(1);

    proxyRequest.mockReset();
    proxyRequest.mockResolvedValueOnce(pageOf([]));
    await new NavigationService().getLensItems(req, { lens: 'project', favoritedUids: ['fav-1'], pageToken: 'tok' });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('splits more than QUERY_SERVICE_FILTERS_OR_BATCH_SIZE missing favorites into separate batched requests', async () => {
    const missingUids = Array.from({ length: 101 }, (_, i) => `fav-${i}`);
    const batch1Projects = missingUids.slice(0, 100).map((uid) => ({ uid, slug: uid, name: uid, stage: 'Active' as Project['stage'] }));
    const batch2Projects = missingUids.slice(100).map((uid) => ({ uid, slug: uid, name: uid, stage: 'Active' as Project['stage'] }));

    proxyRequest.mockResolvedValueOnce(pageOf([])); // initial browse page
    proxyRequest.mockResolvedValueOnce(pageOf(batch1Projects)); // batch 1: 100 uids
    proxyRequest.mockResolvedValueOnce(pageOf(batch2Projects)); // batch 2: remaining 1 uid

    const response = await new NavigationService().getLensItems(req, { lens: 'project', favoritedUids: missingUids });

    expect(proxyRequest).toHaveBeenCalledTimes(3);
    expect(proxyRequest.mock.calls[1][4]).toMatchObject({ filters_or: expect.arrayContaining([`uid:${missingUids[0]}`]), page_size: '101' });
    expect((proxyRequest.mock.calls[1][4] as LensItemsQuery).filters_or).toHaveLength(100);
    expect(proxyRequest.mock.calls[2][4]).toMatchObject({ filters_or: [`uid:${missingUids[100]}`], page_size: '2' });
    expect(response.items.map((i) => i.uid)).toEqual(missingUids);
  });

  it('does not inject a FormationConfidential favorite into the general browse list', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([])); // initial browse page
    proxyRequest.mockResolvedValueOnce(
      pageOf([{ uid: 'confidential-1', slug: 'confidential-1', name: 'Secret', stage: 'Formation - Confidential' as Project['stage'] }])
    );

    const response = await new NavigationService().getLensItems(req, { lens: 'project', favoritedUids: ['confidential-1'] });

    expect(response.items).toHaveLength(0);
  });

  it('follows page_token pagination within a single batch of missing favorites', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([])); // initial browse page
    proxyRequest.mockResolvedValueOnce({
      resources: [{ type: 'project', id: 'project:fav-1', data: { uid: 'fav-1', slug: 'fav-1', name: 'Favorite 1', stage: 'Active' } as Project }],
      page_token: 'next-page',
    });
    proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'fav-2', slug: 'fav-2', name: 'Favorite 2', stage: 'Active' as Project['stage'] }]));

    const response = await new NavigationService().getLensItems(req, { lens: 'project', favoritedUids: ['fav-1', 'fav-2'] });

    expect(proxyRequest).toHaveBeenCalledTimes(3);
    expect(proxyRequest.mock.calls[2][4]).toMatchObject({ page_token: 'next-page' });
    expect(response.items.map((i) => i.uid)).toEqual(['fav-1', 'fav-2']);
  });
});
