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
 * The announcement date the checklist read serves. Since #2719 the sidebar formation card renders
 * it straight off this response ("Oct 25, 2026") rather than off the separate, `auditor`-gated
 * project-settings read, so it is pinned here rather than computed from `Date.now()` — the card's
 * assertion must not drift with the clock.
 */
export const MOCK_FORMATION_ANNOUNCEMENT_DATE = '2026-10-25';

/**
 * The other queue row's announcement date, pinned for the same reason and deliberately earlier
 * than `MOCK_FORMATION_ANNOUNCEMENT_DATE`: the queue sorts by `announcement_date` ASC, so a
 * `Date.now()`-derived value here would flip these two rows' relative order once the wall clock
 * passed the pinned date — latent today, a foot-gun for the first order-sensitive assertion.
 */
export const MOCK_FORMATION_QUEUE_EARLIER_ANNOUNCEMENT_DATE = '2026-09-28';

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
    sub_stage_raw: 'Formation - Engaged',
    lifecycle: 'live',
    lifecycle_raw: 'live',
    announcement_date: MOCK_FORMATION_ANNOUNCEMENT_DATE,
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
 * 2 — the BFF's post-normalization queue-row shape, not the checklist-read `Formation` shape and
 * not the raw upstream `UpstreamFormationQueueRow` the indexer publishes): `progress` replaces
 * `gating_items_open`/`gating_items_total`, `gates_cleared` mirrors what each row's old
 * `is_activating` value implied (open === 0), and `sub_stage`/`sub_stage_raw` (GH-2366) carry the
 * already-normalized short key and its verbatim upstream source, since these mocks stand in for
 * the BFF response, not the raw projection.
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
    sub_stage_raw: 'Formation - Engaged',
    lifecycle: 'live',
    gates_cleared: false,
    is_activating: false,
    announcement_date: mockFormations['cascade-data-alliance'].announcement_date,
    // Mirrors mockFormationItems['formation:cascade-data-alliance']: draft_project_record=done,
    // contribution_agreement_executed=in_progress.
    progress: { not_started: 0, in_progress: 1, blocked: 0, done: 1, skipped: 0 },
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
    sub_stage_raw: 'Formation - On Hold',
    lifecycle: 'live',
    gates_cleared: false,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 0, in_progress: 6, blocked: 0, done: 0, skipped: 0 },
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
    sub_stage_raw: 'Formation - Engaged',
    lifecycle: 'live',
    gates_cleared: true,
    is_activating: true,
    announcement_date: MOCK_FORMATION_QUEUE_EARLIER_ANNOUNCEMENT_DATE,
    progress: { not_started: 0, in_progress: 0, blocked: 0, done: 4, skipped: 0 },
    blocked_item_titles: [],
    assignees: [],
  },
];

/**
 * Queue rows covering every lifecycle the formation service can publish, for GH-2584's exclusion
 * tests. Kept separate from {@link mockFormationsQueue} so the existing queue specs' counts stay
 * as they are — this set exists to be filtered, that one to be rendered.
 *
 * `lifecycle` is the field under test, so each row states it explicitly rather than deriving it
 * from `sub_stage_raw`: the whole point of GH-2584 is that the queue no longer infers one from the
 * other, and a fixture that did infer it could not detect a regression back to stage-based
 * filtering.
 */
export const mockFormationsQueueLifecycleMix: FormationQueueRow[] = [
  {
    formation_uid: 'formation:still-forming-fixture',
    project_uid: 'f10f1234-f567-4abc-b890-1234567890a0',
    project_name: 'Still Forming Initiative',
    project_slug: 'still-forming-initiative',
    is_foundation: false,
    parent_uid: null,
    sub_stage: 'engaged',
    sub_stage_raw: 'Formation - Engaged',
    lifecycle: 'live',
    gates_cleared: false,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 2, in_progress: 1, blocked: 0, done: 1, skipped: 0 },
    blocked_item_titles: [],
    assignees: [],
  },
  {
    // GH-2584's headline case. `frozen`, the same lifecycle Archived gets — the formation service
    // treats leaving formation the same way whether the project succeeded or walked away.
    formation_uid: 'formation:disengaged-fixture',
    project_uid: 'f20f1234-f567-4abc-b890-1234567890a1',
    project_name: 'Disengaged Initiative',
    project_slug: 'disengaged-initiative',
    is_foundation: false,
    parent_uid: null,
    sub_stage: null,
    sub_stage_raw: 'Formation - Disengaged',
    lifecycle: 'frozen',
    gates_cleared: false,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 4, in_progress: 0, blocked: 0, done: 2, skipped: 0 },
    blocked_item_titles: [],
    assignees: [],
  },
  {
    formation_uid: 'formation:activated-fixture',
    project_uid: 'f30f1234-f567-4abc-b890-1234567890a2',
    project_name: 'Activated Initiative',
    project_slug: 'activated-initiative',
    is_foundation: false,
    parent_uid: null,
    sub_stage: null,
    sub_stage_raw: 'Active',
    lifecycle: 'completed',
    gates_cleared: true,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 0, in_progress: 0, blocked: 0, done: 6, skipped: 0 },
    blocked_item_titles: [],
    assignees: [],
  },
  {
    formation_uid: 'formation:archived-fixture',
    project_uid: 'f40f1234-f567-4abc-b890-1234567890a3',
    project_name: 'Archived Initiative',
    project_slug: 'archived-initiative',
    is_foundation: false,
    parent_uid: null,
    sub_stage: null,
    sub_stage_raw: 'Archived',
    lifecycle: 'frozen',
    gates_cleared: false,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 3, in_progress: 0, blocked: 0, done: 3, skipped: 0 },
    blocked_item_titles: [],
    assignees: [],
  },
  {
    // Still forming, but at a sub-stage the queue's taxonomy has no tile for — the fail-open case
    // (GH-2366). It must be listed and counted as unmapped, which is what keeps `tiles.unmapped`
    // worth computing after GH-2584 removed the tile line that displayed it.
    formation_uid: 'formation:unmapped-fixture',
    project_uid: 'f50f1234-f567-4abc-b890-1234567890a4',
    project_name: 'Unmapped Substage Initiative',
    project_slug: 'unmapped-substage-initiative',
    is_foundation: false,
    parent_uid: null,
    sub_stage: null,
    sub_stage_raw: 'Formation - Some New Substage',
    lifecycle: 'live',
    gates_cleared: false,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 5, in_progress: 1, blocked: 0, done: 0, skipped: 0 },
    blocked_item_titles: [],
    assignees: [],
  },
  {
    // A Confidential formation, reaching the BFF because this caller holds permission on it. It is
    // still forming, so it must be listed. Confidentiality is enforced by access control upstream,
    // never by this filter — a row that gets here has already been authorized, and dropping it
    // would hide the project from the only people entitled to act on it (GH-1954).
    formation_uid: 'formation:confidential-fixture',
    project_uid: 'f60f1234-f567-4abc-b890-1234567890a5',
    project_name: 'Confidential Initiative',
    project_slug: 'confidential-initiative',
    is_foundation: false,
    parent_uid: null,
    sub_stage: null,
    sub_stage_raw: 'Formation - Confidential',
    lifecycle: 'live',
    gates_cleared: false,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 6, in_progress: 0, blocked: 0, done: 0, skipped: 0 },
    blocked_item_titles: [],
    assignees: [],
  },
];

export function getMockFormation(projectSlug: string): Formation | undefined {
  return mockFormations[projectSlug];
}
