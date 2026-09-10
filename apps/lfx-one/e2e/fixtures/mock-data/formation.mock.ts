// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SEEDED_FORMATION_TEMPLATE_UID } from '@lfx-one/shared/constants';
import { Formation, FormationQueueRow, FormationTemplate } from '@lfx-one/shared/interfaces';

/** Minimal e2e-side mirror of the server's seeded template — self-contained so e2e specs never import from `src/server`. */
export const mockFormationTemplate: FormationTemplate = {
  uid: SEEDED_FORMATION_TEMPLATE_UID,
  version: 1,
  name: 'Project formation',
  sections: [
    { key: 'legal_and_entity', title: 'Legal and entity', items: [] },
    { key: 'community_and_launch', title: 'Community and launch', items: [] },
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
    is_foundation: true,
    parent_uid: null,
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    sub_stage: 'engaged',
    announcement_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    is_activating: false,
    // Mirrors mockFormationItems['formation:cascade-data-alliance']: 2 gating items
    // (draft_project_record=done, contribution_agreement_executed=in_progress) — this same fixture
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

/**
 * A queue-only list, independent of `mockFormations` — the Formations queue table (GH-1958) is
 * root-scoped, not tied to a single project-page test. Shaped as `FormationQueueRow` (GH-2267 gap
 * 2 — the real indexed queue projection, not the checklist-read `Formation` shape): `progress`
 * replaces `gating_items_open`/`gating_items_total`, and `gates_cleared` mirrors what each row's
 * old `is_activating` value implied (open === 0).
 */
export const mockFormationsQueue: FormationQueueRow[] = [
  {
    formation_uid: mockFormations['cascade-data-alliance'].uid!,
    project_uid: mockFormations['cascade-data-alliance'].parent_project_uid,
    project_name: mockFormations['cascade-data-alliance'].parent_project_name,
    project_slug: mockFormations['cascade-data-alliance'].parent_project_slug,
    is_foundation: mockFormations['cascade-data-alliance'].is_foundation,
    parent_uid: mockFormations['cascade-data-alliance'].parent_uid,
    sub_stage: mockFormations['cascade-data-alliance'].sub_stage,
    lifecycle: 'formation',
    gates_cleared: false,
    is_activating: false,
    announcement_date: mockFormations['cascade-data-alliance'].announcement_date,
    // Mirrors mockFormationItems['formation:cascade-data-alliance']: draft_project_record=done,
    // contribution_agreement_executed=in_progress.
    progress: { not_started: 0, in_progress: 1, blocked: 0, awaiting_acceptance: 0, done: 1, skipped: 0 },
    blocked_item_titles: ['Contribution agreement executed'],
    assignees: [],
  },
  {
    formation_uid: 'formation:harbor-data-exchange',
    project_uid: 'e29f1234-f567-4abc-b890-1234567890df',
    project_name: 'Harbor Data Exchange',
    project_slug: 'harbor-data-exchange',
    is_foundation: false,
    parent_uid: 'e19f1234-f567-4abc-b890-1234567890de',
    sub_stage: 'on_hold',
    lifecycle: 'formation',
    gates_cleared: false,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 0, in_progress: 6, blocked: 0, awaiting_acceptance: 0, done: 0, skipped: 0 },
    blocked_item_titles: ['Intake review'],
    assignees: [],
  },
  {
    formation_uid: 'formation:brightpath-working-group',
    project_uid: 'e39f1234-f567-4abc-b890-1234567890e0',
    project_name: 'Brightpath Working Group',
    project_slug: 'brightpath-working-group',
    is_foundation: false,
    parent_uid: 'e19f1234-f567-4abc-b890-1234567890de',
    sub_stage: 'engaged',
    lifecycle: 'formation',
    gates_cleared: true,
    is_activating: true,
    announcement_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    progress: { not_started: 0, in_progress: 0, blocked: 0, awaiting_acceptance: 0, done: 4, skipped: 0 },
    blocked_item_titles: [],
    assignees: [],
  },
];

export function getMockFormation(projectSlug: string): Formation | undefined {
  return mockFormations[projectSlug];
}
