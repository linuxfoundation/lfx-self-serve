// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '@lfx-one/shared/enums';
import { SEEDED_FORMATION_TEMPLATE_UID } from '@lfx-one/shared/constants';
import type { Formation, FormationItem, FormationItemStatus, FormationLead, FormationSubStage, FormationTemplate } from '@lfx-one/shared/interfaces';
import crypto from 'crypto';

/**
 * Fixture data generators for the Formation Checklist section and Formations queue (GH-1958),
 * ahead of the real `lfx-v2-formation-service` (#1957). Pure — the mutable write store this data
 * feeds lives in `formation-store.service.ts`. TODO(#1957): every generator here is the fixture
 * side of `formation.service.ts`'s `isFormationServiceLive()` branch — swap the service's fixture
 * calls for real proxy calls once that ships; this file's shapes already match the shared
 * `Formation`/`FormationItem` interfaces, so downstream code needs no change.
 *
 * The seeded template's real content is #1959's responsibility (a parallel Epic-1 ticket) — this
 * one is a structurally faithful placeholder (2 sections, 6 gating items, mirrors the reviewed
 * design mockup) so this ticket's UI has something real to render against without blocking on
 * #1959 landing first.
 */

const SYNTHETIC_STAFF: FormationLead[] = [
  { username: 'alex.rivera', name: 'Alex Rivera' },
  { username: 'sam.chen', name: 'Sam Chen' },
  { username: 'jordan.blake', name: 'Jordan Blake' },
  { username: 'taylor.reed', name: 'Taylor Reed' },
  { username: 'morgan.hale', name: 'Morgan Hale' },
];

interface SeedTemplateItem {
  key: string;
  title: string;
  is_gating: boolean;
  owner_team: string;
  action: FormationItem['action'];
}

interface SeedSection {
  key: string;
  title: string;
  items: SeedTemplateItem[];
}

const SEED_SECTIONS: SeedSection[] = [
  {
    key: 'legal-and-entity',
    title: 'Legal and entity',
    items: [
      { key: 'draft-project-record', title: 'Draft project record (Prospect)', is_gating: true, owner_team: 'PMO', action: 'link' },
      { key: 'intake-form-submitted', title: 'Intake form submitted', is_gating: true, owner_team: 'Community', action: 'link' },
      {
        key: 'formation-review-packet',
        title: 'Formation review and instruction packet',
        is_gating: true,
        owner_team: 'Formation',
        action: 'link',
      },
      {
        key: 'preliminary-trademark-search',
        title: 'Preliminary trademark search',
        is_gating: false,
        owner_team: 'Brand Counsel',
        action: 'link',
      },
      {
        key: 'technical-charter-agreed',
        title: 'Technical charter reviewed and agreed',
        is_gating: true,
        owner_team: 'Community',
        action: 'link',
      },
      {
        key: 'contribution-agreement-executed',
        title: 'Contribution agreement executed',
        is_gating: true,
        owner_team: 'Formation',
        action: 'link',
      },
      {
        key: 'in-depth-trademark-series-llc',
        title: 'In-depth trademark search and Series LLC',
        is_gating: true,
        owner_team: 'Formation',
        action: 'manual',
      },
    ],
  },
  {
    key: 'community-and-launch',
    title: 'Community and launch',
    items: [
      {
        key: 'repositories-connected',
        title: 'Repositories connected; GitHub org set up',
        is_gating: false,
        owner_team: 'Community',
        action: 'provisionable',
      },
      { key: 'domain-and-dns-transfer', title: 'Domain and DNS transfer', is_gating: false, owner_team: 'Community', action: 'request' },
      { key: 'website-logo-footer', title: 'Website, logo and entity footer', is_gating: false, owner_team: 'PMO', action: 'link' },
      { key: 'mailing-lists', title: 'Mailing lists', is_gating: false, owner_team: 'PMO', action: 'provisionable' },
      { key: 'chat-workspace', title: 'Chat workspace (Slack)', is_gating: false, owner_team: 'IT', action: 'provisionable' },
      {
        key: 'insights-onboarding',
        title: 'LFX Insights onboarding and project lead access',
        is_gating: false,
        owner_team: 'PMO',
        action: 'request',
      },
      {
        key: 'asset-transfers',
        title: 'Asset transfers: trademarks, service accounts, social',
        is_gating: false,
        owner_team: 'PMO',
        action: 'manual',
      },
      { key: 'tsc-formed', title: 'TSC formed and kickoff scheduled', is_gating: false, owner_team: 'PMO', action: 'provisionable' },
      { key: 'member-join-page', title: 'Member join page', is_gating: false, owner_team: 'Product', action: 'provisionable' },
      { key: 'launch-communications', title: 'Launch communications', is_gating: false, owner_team: 'Marketing', action: 'link' },
      {
        key: 'formation-sets-active',
        title: 'Formation sets stage to Active',
        is_gating: false,
        owner_team: 'Formation',
        action: 'status_only',
      },
    ],
  },
];

export const SEEDED_FORMATION_TEMPLATE: FormationTemplate = {
  uid: SEEDED_FORMATION_TEMPLATE_UID,
  version: 1,
  name: 'Project formation',
  sections: SEED_SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    items: section.items.map((item) => ({
      key: item.key,
      title: item.title,
      is_gating: item.is_gating,
      owner_team: item.owner_team,
      action: item.action,
    })),
  })),
};

function hashToUnitFloat(seed: string): number {
  const digest = crypto.createHash('sha256').update(seed).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function pickFromPool<T>(pool: T[], seed: string): T {
  const index = Math.floor(hashToUnitFloat(seed) * pool.length) % pool.length;
  return pool[index];
}

/** Position-weighted so earlier template items skew further along — a plausible in-progress checklist, not uniform noise. */
function deriveItemStatus(seed: string, position: number, total: number): FormationItemStatus {
  const progress = total > 1 ? 1 - position / (total - 1) : 1;
  const score = progress * 0.7 + hashToUnitFloat(seed) * 0.3;
  if (score > 0.72) return 'done';
  if (score > 0.5) return 'in_progress';
  if (score > 0.44) return 'waiting_on_partner';
  return 'not_started';
}

function mapProjectStageToSubStage(stage: ProjectStage | string | undefined, isActivating: boolean): FormationSubStage {
  if (isActivating) return 'activating';
  switch (stage) {
    case ProjectStage.FormationExploratory:
      return 'exploratory';
    case ProjectStage.FormationOnHold:
      return 'on_hold';
    case ProjectStage.FormationEngaged:
    default:
      return 'engaged';
  }
}

interface GenerateFormationInput {
  projectUid: string;
  projectSlug: string;
  projectName: string;
  parentProjectUid: string | null;
  stage: ProjectStage | string | undefined;
}

/** Deterministic per-project fixture generator (SHA-256-seeded off `projectUid`, never `Math.random()`) — same request yields the same response every reload. */
export function generateMockFormation(input: GenerateFormationInput): { formation: Formation; items: FormationItem[] } {
  const flatItems = SEED_SECTIONS.flatMap((section) => section.items.map((item) => ({ section, item })));
  const total = flatItems.length;

  const items: FormationItem[] = flatItems.map(({ section, item }, index) => {
    const seed = `${input.projectUid}:${item.key}`;
    const status: FormationItemStatus = deriveItemStatus(seed, index, total);
    const owner = pickFromPool(SYNTHETIC_STAFF, `${seed}:owner`);

    return {
      uid: `formation-item:${seed}`,
      formation_uid: `formation:${input.projectUid}`,
      template_item_key: item.key,
      section_key: section.key,
      section_title: section.title,
      title: item.title,
      status,
      is_gating: item.is_gating,
      owner_team: item.owner_team,
      owner,
      due_date: null,
      action: item.action,
      // '#' isn't an absolute http(s) URL, so isValidUrl (the same guard action_href is checked
      // against before it ever reaches [href]) rejects it — every generated link/status_only item
      // would render the disabled "Link unavailable" fallback against a real dev server. A
      // synthetic but valid absolute URL keeps the enabled path exercisable outside of e2e's mocks.
      action_href: item.action === 'link' || item.action === 'status_only' ? `https://example.com/formation/${item.key}` : null,
      detail: null,
      notes: null,
      links: [],
      sub_items: [],
      // deriveItemStatus never returns 'skipped' for a freshly generated item — only skipFormationItem sets it, after generation.
      skip_reason: null,
      // Overwritten by FormationItemAccessService.canComplete before the response leaves formation.service.ts.
      can_complete: false,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };
  });

  const gatingItems = items.filter((item) => item.is_gating);
  // A skipped gating item is resolved, not open — see the matching note on refreshFormationReadiness.
  const openGatingItems = gatingItems.filter((item) => item.status !== 'done' && item.status !== 'skipped');
  const isActivating = gatingItems.length > 0 && openGatingItems.length === 0;
  const blockingItem = openGatingItems[0] ?? null;

  const formation: Formation = {
    uid: `formation:${input.projectUid}`,
    parent_project_uid: input.projectUid,
    parent_project_slug: input.projectSlug,
    parent_project_name: input.projectName,
    entity_type: input.parentProjectUid ? 'subproject' : 'foundation',
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    state: 'active',
    sub_stage: mapProjectStageToSubStage(input.stage, isActivating),
    announcement_date: isActivating ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() : null,
    is_activating: isActivating,
    gating_items_open: openGatingItems.length,
    gating_items_total: gatingItems.length,
    blocking_item_title: blockingItem?.title ?? null,
    lead: pickFromPool(SYNTHETIC_STAFF, `${input.projectUid}:lead`),
    proposer: null,
    subtitle: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  return { formation, items };
}

// ---- Formations queue: small static curated list (not generated) — the queue is staff-only and
// needs exactly one of each interesting scenario for UI testing, which a generator would fight
// against (a generator can't guarantee "exactly one Withdrawn row" the way a curated list can).

export const STATIC_QUEUE_FORMATIONS: Formation[] = [
  {
    uid: 'formation:queue-1',
    parent_project_uid: 'queue-project-1',
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
    lead: SYNTHETIC_STAFF[0],
    proposer: null,
    subtitle: 'With Northbridge Systems · Transition of an existing alliance',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:queue-2',
    parent_project_uid: 'queue-project-2',
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
    proposer: SYNTHETIC_STAFF[1],
    subtitle: 'Under Cascade Data Alliance · Proposed by Northbridge Systems',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:queue-3',
    parent_project_uid: 'queue-project-3',
    parent_project_slug: 'lakeshore-toolkit',
    parent_project_name: 'Lakeshore compartmentalization toolkit',
    entity_type: 'subproject',
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    state: 'active',
    sub_stage: 'exploratory',
    announcement_date: null,
    is_activating: false,
    gating_items_open: 5,
    gating_items_total: 6,
    blocking_item_title: 'Trademark status',
    lead: SYNTHETIC_STAFF[2],
    proposer: null,
    subtitle: 'Under Meridian Research Consortium · No PMO contact',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:queue-4',
    parent_project_uid: 'queue-project-4',
    parent_project_slug: 'agent-name-service',
    parent_project_name: 'Agent Name Service',
    entity_type: 'project',
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    state: 'active',
    sub_stage: 'engaged',
    announcement_date: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
    is_activating: false,
    gating_items_open: 2,
    gating_items_total: 6,
    blocking_item_title: 'Code assignment',
    lead: SYNTHETIC_STAFF[2],
    proposer: null,
    subtitle: 'Project transfer from a prior host · Intent announced',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:queue-5',
    parent_project_uid: 'queue-project-5',
    parent_project_slug: 'appia-foundation',
    parent_project_name: 'Appia Foundation',
    entity_type: 'foundation',
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    state: 'active',
    sub_stage: 'activating',
    announcement_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    is_activating: true,
    gating_items_open: 0,
    gating_items_total: 6,
    blocking_item_title: null,
    lead: SYNTHETIC_STAFF[3],
    proposer: null,
    subtitle: 'Gating items done, ready to set Active',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:queue-6',
    parent_project_uid: 'queue-project-6',
    parent_project_slug: 'value-measurement-spec',
    parent_project_name: 'AI value measurement spec',
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
    proposer: SYNTHETIC_STAFF[4],
    subtitle: 'Under Tokenomics Foundation',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:queue-7',
    parent_project_uid: 'queue-project-7',
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
    proposer: SYNTHETIC_STAFF[1],
    subtitle: 'Withdrawn — proposer opted out before formation completed',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
];

// The write store (seedFormation/getStoredFormation/putStoredItem/appendActivity/etc.) lives in
// `formation-store.service.ts`, not here — this file stays pure generators, matching every other
// file in `helpers/` (see `docs/architecture/backend/server-helpers.md`: "Keep helpers pure — no
// shared mutable state").
