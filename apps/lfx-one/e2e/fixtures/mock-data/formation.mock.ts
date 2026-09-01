// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SEEDED_FORMATION_TEMPLATE_UID } from '@lfx-one/shared/constants';
import { Formation, FormationLead, FormationTemplate } from '@lfx-one/shared/interfaces';

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
const SYNTHETIC_LEAD: FormationLead = { username: 'alex.rivera', name: 'Alex Rivera' };

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
    gating_items_open: 3,
    gating_items_total: 6,
    blocking_item_title: 'Contribution agreement executed',
    lead: SYNTHETIC_LEAD,
    proposer: null,
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
    state: 'draft',
    sub_stage: 'proposed',
    announcement_date: null,
    is_activating: false,
    gating_items_open: 6,
    gating_items_total: 6,
    blocking_item_title: 'Intake review',
    lead: null,
    proposer: { username: 'sam.chen', name: 'Sam Chen' },
    subtitle: 'Under Cascade Data Alliance · Proposed by Northbridge Systems',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:formerly-brightpath',
    parent_project_uid: 'e39f1234-f567-4abc-b890-1234567890e0',
    parent_project_slug: 'formerly-brightpath',
    parent_project_name: 'Formerly Brightpath Working Group',
    entity_type: 'subproject',
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    state: 'withdrawn',
    sub_stage: 'withdrawn',
    announcement_date: null,
    is_activating: false,
    gating_items_open: 4,
    gating_items_total: 6,
    blocking_item_title: null,
    lead: null,
    proposer: { username: 'jordan.blake', name: 'Jordan Blake' },
    subtitle: 'Withdrawn — proposer opted out before formation completed',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
];

export function getMockFormation(projectSlug: string): Formation | undefined {
  return mockFormations[projectSlug];
}
