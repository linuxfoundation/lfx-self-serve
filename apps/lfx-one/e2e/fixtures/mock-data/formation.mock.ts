// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SEEDED_FORMATION_TEMPLATE_UID } from '@lfx-one/shared/constants';
import { Formation, FormationTemplate } from '@lfx-one/shared/interfaces';

/** Minimal e2e-side mirror of the server's seeded template — self-contained so e2e specs never import from `src/server`. */
export const mockFormationTemplate: FormationTemplate = {
  uid: SEEDED_FORMATION_TEMPLATE_UID,
  version: 1,
  name: 'Project formation',
  sections: [
    { key: 'legal-and-entity', title: 'Legal and entity', items: [] },
    { key: 'community-and-launch', title: 'Community and launch', items: [] },
  ],
};

/**
 * Mock formation data for Playwright tests (GH-1958). Keyed by parent project slug, mirroring
 * `projects.mock.ts`'s `mockProjects` convention — a checklist test navigates to a project whose
 * slug has both a `mockProjects` entry (a Formation-stage `stage`) and a `mockFormations` entry.
 */
export const mockFormations: Record<string, Formation> = {
  'cascade-data-alliance': {
    uid: 'formation:cascade-data-alliance',
    parent_project_uid: 'e19f1234-f567-4abc-b890-1234567890de',
    parent_project_slug: 'cascade-data-alliance',
    parent_project_name: 'Cascade Data Alliance',
    entity_type: 'foundation',
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    state: 'active',
    sub_stage: 'engaged',
    announcement_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    is_activating: false,
    // Mirrors mockFormationItems['formation:cascade-data-alliance']: 2 gating items
    // (draft-project-record=done, contribution-agreement-executed=in_progress) — this same fixture
    // backs both the checklist (counts derived from items) and the queue (counts read from this
    // row), so a mismatch here would render two different "N of M open" numbers for one formation.
    gating_items_open: 1,
    gating_items_total: 2,
    blocking_item_title: 'Contribution agreement executed',
    subtitle: 'With Northbridge Systems · Transition of an existing alliance',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
};

/** A queue-only list, independent of `mockFormations` — the Formations queue table (GH-1958) is root-scoped, not tied to a single project-page test. */
export const mockFormationsQueue: Formation[] = [
  mockFormations['cascade-data-alliance'],
  {
    uid: 'formation:harbor-data-exchange',
    parent_project_uid: 'e29f1234-f567-4abc-b890-1234567890df',
    parent_project_slug: 'harbor-data-exchange',
    parent_project_name: 'Harbor Data Exchange',
    entity_type: 'subproject',
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    state: 'active',
    sub_stage: 'on_hold',
    announcement_date: null,
    is_activating: false,
    gating_items_open: 6,
    gating_items_total: 6,
    blocking_item_title: 'Intake review',
    subtitle: 'Under Cascade Data Alliance',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:brightpath-working-group',
    parent_project_uid: 'e39f1234-f567-4abc-b890-1234567890e0',
    parent_project_slug: 'brightpath-working-group',
    parent_project_name: 'Brightpath Working Group',
    entity_type: 'subproject',
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    state: 'active',
    sub_stage: 'activating',
    announcement_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    is_activating: true,
    gating_items_open: 0,
    gating_items_total: 4,
    blocking_item_title: null,
    subtitle: 'Under Cascade Data Alliance · Gating items complete',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
];

export function getMockFormation(projectSlug: string): Formation | undefined {
  return mockFormations[projectSlug];
}
