// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_TEMPLATE } from '@lfx-one/shared/constants';
import { ProjectStage } from '@lfx-one/shared/enums';
import type {
  FormationItem,
  FormationItemLink,
  FormationItemMapContext,
  FormationSubItem,
  FormationSubStage,
  UpstreamFormationItem,
} from '@lfx-one/shared/interfaces';
import { isRelativeInAppPath, isValidUrl } from '@lfx-one/shared/utils';

/**
 * Maps `lfx-v2-formation-service`'s wire shapes (GH-2267 Phase 0's contract table, source of truth
 * `cmd/formation-api/design/design.go` at `linuxfoundation/lfx-v2-formation-service@main`) onto
 * this repo's `Formation`/`FormationItem` shared types. Every field this file derives rather than
 * copies verbatim (`section_title`, `action`, `action_href`, `links`, `detail`) has no upstream
 * source at all — see the GH-2267 plan's Phase 5 "checklist read" section for why each one is
 * derived from the seeded `FORMATION_TEMPLATE` instead. The raw upstream shapes themselves
 * (`UpstreamFormationItem`/`UpstreamFormationChecklist`/`FormationItemMapContext`) live in
 * `@lfx-one/shared/interfaces` rather than here, per this repo's "no local interface in
 * apps/lfx-one" convention.
 */

const TEMPLATE_ITEMS_BY_KEY = new Map(FORMATION_TEMPLATE.sections.flatMap((section) => section.items.map((item) => [item.key, item])));
const TEMPLATE_SECTION_TITLES_BY_KEY = new Map(FORMATION_TEMPLATE.sections.map((section) => [section.key as string, section.title]));

/**
 * `status_source: 'platform'` always means `provisionable` regardless of the seeded template's own
 * action (GH-2267 Phase 5) — LFX itself provisioned/checked the resource, so the row is never a
 * manual/link/request affordance no matter what the template says. Anything else falls back to the
 * template's own `action` by `item_key`; an item_key the template doesn't know (a future upstream
 * addition this BFF hasn't been updated for) defaults to `'manual'` rather than throwing, since a
 * checklist row missing its action affordance is a display gap, not a fatal one.
 */
function deriveItemAction(raw: UpstreamFormationItem): FormationItem['action'] {
  if (raw.status_source === 'platform') return 'provisionable';
  const templateItem = TEMPLATE_ITEMS_BY_KEY.get(raw.item_key);
  return templateItem?.action ?? 'manual';
}

/**
 * Upstream deliberately leaves `{{project.slug}}` unresolved in a template's `action_link`
 * (GH-2267 Phase 5) — substituted here, once, rather than rendered raw. A link that still fails
 * scheme/shape validation after substitution is dropped (`null`) rather than passed through: a
 * broken href is worse than no link, and this field is untrusted service output bound into `[href]`
 * downstream (see `FormationItem.action_href`'s doc comment).
 */
function resolveActionHref(actionLink: string | null | undefined, projectSlug: string): string | null {
  if (!actionLink) return null;
  const resolved = actionLink.replace(/\{\{\s*project\.slug\s*\}\}/g, projectSlug);
  if (isRelativeInAppPath(resolved) || isValidUrl(resolved)) return resolved;
  return null;
}

/** Single `http`/`https` `evidence_link` field → `links[]` (decided on #1957, 9 Sep — see the GH-2267 plan's gap 5). Never a second field. */
function mapEvidenceLinkToLinks(evidenceLink: string | null | undefined): FormationItemLink[] {
  if (!evidenceLink || !isValidUrl(evidenceLink)) return [];
  return [{ label: 'Evidence', href: evidenceLink }];
}

/**
 * Shared by the fixture generator and the live checklist mapper — `sub_stage` has no direct
 * upstream/fixture field of its own, only `ProjectStage`, so both paths derive it identically.
 * Lives here rather than in `formation-fixture.helper.ts` so it isn't fixture-only.
 */
export function deriveFormationSubStage(stage: ProjectStage | string | undefined): FormationSubStage {
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

function mapSubItems(subItems: UpstreamFormationItem['sub_items']): FormationSubItem[] {
  if (!subItems || subItems.length === 0) return [];
  return subItems.map((subItem) => ({ uid: subItem.key, title: subItem.title, status: subItem.status }));
}

/**
 * Maps one upstream item onto `FormationItem`. `can_complete` is always `false` here — every caller
 * runs the result through `FormationService.enrichSingle`/`enrichItems` afterward, same as the
 * fixture generator's own placeholder. `created_at`/`updated_at` have no upstream source on this
 * path (unlike `Formation`'s equivalent gap, this one isn't raised upstream yet since nothing reads
 * an item's own timestamps today) — the mapping time stands in rather than leaving the field
 * `undefined`, since `FormationItem.created_at`/`updated_at` are non-optional.
 */
export function mapUpstreamFormationItem(raw: UpstreamFormationItem, ctx: FormationItemMapContext): FormationItem {
  const now = new Date().toISOString();
  return {
    uid: raw.uid,
    formation_uid: ctx.formationUid,
    project_uid: ctx.projectUid,
    template_item_key: raw.item_key,
    section_key: raw.section_key,
    section_title: TEMPLATE_SECTION_TITLES_BY_KEY.get(raw.section_key) ?? raw.section_key,
    title: raw.title,
    status: raw.status,
    is_gating: raw.gate,
    owner_team: raw.owner_team ?? TEMPLATE_ITEMS_BY_KEY.get(raw.item_key)?.owner_team ?? null,
    owner: raw.assignee ? { username: raw.assignee, name: raw.assignee } : null,
    due_date: raw.due_date ?? null,
    action: deriveItemAction(raw),
    action_href: resolveActionHref(raw.action_link, ctx.projectSlug),
    detail: null,
    notes: raw.note ?? null,
    links: mapEvidenceLinkToLinks(raw.evidence_link),
    sub_items: mapSubItems(raw.sub_items),
    skip_reason: raw.skip_reason ?? null,
    can_complete: false,
    created_at: now,
    updated_at: now,
    version: raw.version,
  };
}

// Note: `getProjectFormation`'s live branch (mapping `UpstreamFormationChecklist` onto `Formation`)
// is not yet wired — see the GH-2267 plan's Phase 1 remainder. A `mapUpstreamFormationChecklist`
// helper belongs here once that lands, matching `mapUpstreamFormationItem`'s shape.
