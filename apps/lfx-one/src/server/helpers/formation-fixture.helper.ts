// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '@lfx-one/shared/enums';
import { FORMATION_TEMPLATE, SEEDED_FORMATION_TEMPLATE_UID } from '@lfx-one/shared/constants';
import type {
  Formation,
  FormationItem,
  FormationItemStatus,
  FormationSubItem,
  FormationTemplate,
  FormationTemplateSubItem,
  FormationUser,
} from '@lfx-one/shared/interfaces';
import crypto from 'crypto';

import { deriveFormationSubStage } from './formation-mapper.helper';

/**
 * Fixture data generators for the Formation Checklist section and Formations queue (GH-1958),
 * ahead of the real `lfx-v2-formation-service` (#1957). Pure — the mutable write store this data
 * feeds lives in `formation-store.service.ts`. TODO(#1957): every generator here is the fixture
 * side of `formation.service.ts`'s `isFormationServiceLive()` branch — swap the service's fixture
 * calls for real proxy calls once that ships; this file's shapes already match the shared
 * `Formation`/`FormationItem` interfaces, so downstream code needs no change.
 *
 * Template *content* (sections, items, gates, sub-items) comes from #1959's real seeded
 * `FORMATION_TEMPLATE` (`@lfx-one/shared/constants`) — this file only synthesizes runtime-only
 * fixture state on top of it (status, owner, sub-item statuses, `can_complete`, timestamps).
 */

const SYNTHETIC_STAFF: FormationUser[] = [
  { username: 'alex.rivera', name: 'Alex Rivera' },
  { username: 'sam.chen', name: 'Sam Chen' },
  { username: 'jordan.blake', name: 'Jordan Blake' },
  { username: 'taylor.reed', name: 'Taylor Reed' },
  { username: 'morgan.hale', name: 'Morgan Hale' },
];

/** The fixture keeps its own uid — the seeded template's identity is a fixture concern, its content isn't. */
export const SEEDED_FORMATION_TEMPLATE: FormationTemplate = {
  ...FORMATION_TEMPLATE,
  uid: SEEDED_FORMATION_TEMPLATE_UID,
};

/** Every gating item in the real template — derived once so the queue's fixture rows can't drift from #1959's actual gate count. */
const TEMPLATE_GATING_ITEMS_TOTAL = FORMATION_TEMPLATE.sections.flatMap((section) => section.items).filter((item) => item.is_gating).length;

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
  if (score > 0.44) return 'blocked';
  return 'not_started';
}

function deriveSubItems(seed: string, subItems: FormationTemplateSubItem[] | undefined): FormationSubItem[] {
  if (!subItems || subItems.length === 0) return [];
  return subItems.map((subItem, index) => ({
    uid: `formation-sub-item:${seed}:${subItem.key}`,
    title: subItem.title,
    status: deriveItemStatus(`${seed}:${subItem.key}`, index, subItems.length),
  }));
}

interface GenerateFormationInput {
  projectUid: string;
  projectSlug: string;
  projectName: string;
  parentProjectUid: string | null;
  stage: ProjectStage | string | undefined;
}

/**
 * Deterministic per-project fixture generator (SHA-256-seeded off `projectUid`, never
 * `Math.random()`) — same request yields the same response every reload. The returned
 * `formation.uid` is always set (unlike the checklist read's own optional `Formation.uid` — see
 * its doc comment) — narrowed here so callers can hand it straight to the write store, which is
 * keyed by uid.
 */
export function generateMockFormation(input: GenerateFormationInput): { formation: Formation & { uid: string }; items: FormationItem[] } {
  const flatItems = FORMATION_TEMPLATE.sections.flatMap((section) => section.items.map((item) => ({ section, item })));
  const total = flatItems.length;

  const items: FormationItem[] = flatItems.map(({ section, item }, index) => {
    const seed = `${input.projectUid}:${item.key}`;
    const status: FormationItemStatus = deriveItemStatus(seed, index, total);
    const owner = pickFromPool(SYNTHETIC_STAFF, `${seed}:owner`);

    return {
      uid: `formation-item:${seed}`,
      formation_uid: `formation:${input.projectUid}`,
      project_uid: input.projectUid,
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
      // The template's own action_link, if any — no seeded row sets one today, so this is null
      // across the board (including domain_dns, which correctly ships with no destination).
      action_href: item.action_link ?? null,
      detail: null,
      notes: null,
      links: [],
      sub_items: deriveSubItems(seed, item.sub_items),
      // deriveItemStatus never returns 'skipped' for a freshly generated item — only skipFormationItem sets it, after generation.
      skip_reason: null,
      // Overwritten by FormationItemAccessService.canComplete before the response leaves formation.service.ts.
      can_complete: false,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      // Fixture items have no real optimistic-locking history — 1 is a fixed starting value, never
      // incremented, since only the real service (#1957) enforces If-Match.
      version: 1,
    };
  });

  const gatingItems = items.filter((item) => item.is_gating);
  // A skipped gating item is resolved, not open — see the matching note on refreshFormationReadiness.
  const openGatingItems = gatingItems.filter((item) => item.status !== 'done' && item.status !== 'skipped');
  const isActivating = gatingItems.length > 0 && openGatingItems.length === 0;
  const blockedGatingItems = gatingItems.filter((item) => item.status === 'blocked');
  const blockingItemTitle = blockedGatingItems.length > 0 ? blockedGatingItems.map((item) => item.title).join(', ') : null;

  const formation: Formation & { uid: string } = {
    uid: `formation:${input.projectUid}`,
    parent_project_uid: input.projectUid,
    parent_project_slug: input.projectSlug,
    parent_project_name: input.projectName,
    is_foundation: !input.parentProjectUid,
    parent_uid: input.parentProjectUid,
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    sub_stage: deriveFormationSubStage(input.stage),
    announcement_date: isActivating ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() : null,
    is_activating: isActivating,
    gating_items_open: openGatingItems.length,
    gating_items_total: gatingItems.length,
    blocking_item_title: blockingItemTitle,
    subtitle: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  return { formation, items };
}

// ---- Formations queue: small static curated list (not generated) — the queue is staff-only and
// needs exactly one of each interesting scenario for UI testing, which a generator would fight
// against (a generator can't guarantee "exactly one Withdrawn row" the way a curated list can).

export const STATIC_QUEUE_FORMATIONS: (Formation & { uid: string })[] = [
  {
    uid: 'formation:queue-project-1',
    parent_project_uid: 'queue-project-1',
    parent_project_slug: 'cascade-data-alliance',
    parent_project_name: 'Cascade Data Alliance',
    is_foundation: true,
    parent_uid: null,
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    sub_stage: 'engaged',
    announcement_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    is_activating: false,
    gating_items_open: 2,
    gating_items_total: TEMPLATE_GATING_ITEMS_TOTAL,
    blocking_item_title: 'Contribution agreement (DocuSign)',
    subtitle: 'With Northbridge Systems · Transition of an existing alliance',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:queue-project-3',
    parent_project_uid: 'queue-project-3',
    parent_project_slug: 'lakeshore-toolkit',
    parent_project_name: 'Lakeshore compartmentalization toolkit',
    is_foundation: false,
    parent_uid: 'project:meridian-research-consortium',
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    sub_stage: 'exploratory',
    announcement_date: null,
    is_activating: false,
    gating_items_open: 3,
    gating_items_total: TEMPLATE_GATING_ITEMS_TOTAL,
    blocking_item_title: 'In-depth trademark search and Series LLC',
    subtitle: 'Under Meridian Research Consortium · No PMO contact',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:queue-project-4',
    parent_project_uid: 'queue-project-4',
    parent_project_slug: 'agent-name-service',
    parent_project_name: 'Agent Name Service',
    is_foundation: false,
    parent_uid: null,
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    sub_stage: 'engaged',
    announcement_date: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
    is_activating: false,
    gating_items_open: 1,
    gating_items_total: TEMPLATE_GATING_ITEMS_TOTAL,
    blocking_item_title: 'Charter agreed',
    subtitle: 'Project transfer from a prior host · Intent announced',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    uid: 'formation:queue-project-5',
    parent_project_uid: 'queue-project-5',
    parent_project_slug: 'appia-foundation',
    parent_project_name: 'Appia Foundation',
    is_foundation: true,
    parent_uid: null,
    template_uid: SEEDED_FORMATION_TEMPLATE_UID,
    template_version: 1,
    sub_stage: 'engaged',
    announcement_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    is_activating: true,
    gating_items_open: 0,
    gating_items_total: TEMPLATE_GATING_ITEMS_TOTAL,
    blocking_item_title: null,
    subtitle: 'Gating items done, ready to set Active',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
];

// The write store (seedFormation/getStoredFormation/putStoredItem/appendActivity/etc.) lives in
// `formation-store.service.ts`, not here — this file stays pure generators, matching every other
// file in `helpers/` (see `docs/architecture/backend/server-helpers.md`: "Keep helpers pure — no
// shared mutable state").
