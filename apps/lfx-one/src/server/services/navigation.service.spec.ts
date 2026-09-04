// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LensItemsQuery, Project, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors project.service.spec.ts / org-navigation.service.spec.ts: the `@lfx-one/shared/*`
// alias isn't wired into this app's vitest config, so every runtime (non-type-only) import
// needs a stub.
const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));

vi.mock('@lfx-one/shared/enums', () => ({
  // Real enum, not a stub: PROJECT_LENS_ALLOWED_STAGES and getFormationSubStageLabel both
  // compare against actual string values.
  ProjectStage: {
    FormationExploratory: 'Formation - Exploratory',
    FormationEngaged: 'Formation - Engaged',
    FormationOnHold: 'Formation - On Hold',
    FormationDisengaged: 'Formation - Disengaged',
    FormationConfidential: 'Formation - Confidential',
    Active: 'Active',
    Archived: 'Archived',
    Prospect: 'Prospect',
  },
  ProjectFunding: { Funded: 'Funded' },
}));
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

  it('excludes a Confidential-stage selection from fetchSelectedItem re-injection', async () => {
    // First page: normal query returns nothing.
    proxyRequest.mockResolvedValueOnce(pageOf([]));
    // Second call: fetchSelectedItem's uid-scoped lookup returns the Confidential project.
    proxyRequest.mockResolvedValueOnce(
      pageOf([{ uid: 'confidential-1', slug: 'confidential-1', name: 'Secret', stage: 'Formation - Confidential' as Project['stage'] }])
    );

    const response = await new NavigationService().getLensItems(req, { lens: 'project', selectedUid: 'confidential-1' });

    expect(response.items).toHaveLength(0);
  });
});
