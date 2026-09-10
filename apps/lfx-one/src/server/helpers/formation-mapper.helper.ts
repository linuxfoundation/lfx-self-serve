// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_TEMPLATE } from '@lfx-one/shared/constants';
import { FormationTemplateSectionKey, ProjectStage } from '@lfx-one/shared/enums';
import type {
  Formation,
  FormationItem,
  FormationItemLink,
  FormationItemMapContext,
  FormationSubItem,
  FormationSubStage,
  FormationTemplate,
  Project,
  UpstreamFormationChecklist,
  UpstreamFormationItem,
} from '@lfx-one/shared/interfaces';
import { isRelativeInAppPath, isValidUrl } from '@lfx-one/shared/utils';

/**
 * Maps `lfx-v2-formation-service`'s wire shapes (GH-2267 Phase 0's contract table, source of truth
 * `cmd/formation-api/design/design.go` at `linuxfoundation/lfx-v2-formation-service@main`) onto
 * this repo's shared types — `mapUpstreamFormationItem` for one upstream item at a time, and
 * `mapUpstreamFormationChecklist` (GH-2267 Phase 1 remainder) for the `Formation`/`FormationTemplate`
 * pair the checklist read assembles around those items. Every field this file derives rather than
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

/**
 * Everything `mapUpstreamFormationChecklist` needs beyond the raw checklist itself — the project
 * record (for name/slug/stage), the already ROOT-collapsed `parent_uid` ({@link
 * collapseRootParentUid}), the mapped items (to derive gating counts from), and the
 * `announcement_date` (no upstream source on the checklist read itself — see
 * `FormationService.getProjectFormation`'s doc comment for where it comes from instead).
 */
export interface FormationChecklistMapContext {
  project: Pick<Project, 'slug' | 'name' | 'stage'>;
  parentUid: string | null;
  announcementDate: string | null;
  items: FormationItem[];
}

/**
 * Maps `GET /formations/{project_uid}`'s response onto this repo's `Formation`/`FormationTemplate`
 * pair (GH-2267 Phase 1 remainder). `template` is built from the checklist's own `sections` rather
 * than the seeded `FORMATION_TEMPLATE` constant — a template revision on the service side must
 * reach the UI without a BFF redeploy. Each section's `items: []` is deliberate:
 * `FormationTemplateSection.items` is never read anywhere downstream (`groupFormationItemsBySection`
 * only reads `key`/`title`), and every per-item template fact `mapUpstreamFormationItem` needs comes
 * from `TEMPLATE_ITEMS_BY_KEY`, not from this shape. The section `key` cast to
 * `FormationTemplateSectionKey` mirrors the same cast `FORMATION_ORPHAN_SECTION` uses in
 * `formation-checklist.utils.ts` — an upstream section key this BFF doesn't recognize yet is a
 * display gap, not a type error.
 *
 * `formation.uid`/`created_at`/`updated_at` are left `undefined` — all three are optional
 * specifically because the checklist read doesn't return them (see their doc comments on
 * `Formation`); synthesizing a fake `uid` here would disagree with the queue read's real
 * `formation_uid` for the same project.
 */
export function mapUpstreamFormationChecklist(
  raw: UpstreamFormationChecklist,
  ctx: FormationChecklistMapContext
): { formation: Formation; template: FormationTemplate } {
  const template: FormationTemplate = {
    uid: raw.template_uid,
    version: raw.template_version,
    name: FORMATION_TEMPLATE.name,
    sections: [...raw.sections]
      .sort((a, b) => a.position - b.position)
      .map((section) => ({ key: section.key as unknown as FormationTemplateSectionKey, title: section.title, items: [] })),
  };

  // Same rollup rules as FormationService.refreshFormationReadiness (fixture path) and
  // deriveFormationReadinessSummary (client) — a skipped gating item counts as resolved, not open.
  const gatingItems = ctx.items.filter((item) => item.is_gating);
  const openGatingItems = gatingItems.filter((item) => item.status !== 'done' && item.status !== 'skipped');
  const blockedGatingItems = gatingItems.filter((item) => item.status === 'blocked');
  const blockingItemTitle = blockedGatingItems.length > 0 ? blockedGatingItems.map((item) => item.title).join(', ') : null;

  const formation: Formation = {
    parent_project_uid: raw.project_uid,
    parent_project_slug: ctx.project.slug,
    parent_project_name: ctx.project.name,
    is_foundation: !ctx.parentUid,
    parent_uid: ctx.parentUid,
    template_uid: raw.template_uid,
    template_version: raw.template_version,
    sub_stage: deriveFormationSubStage(ctx.project.stage),
    announcement_date: ctx.announcementDate,
    is_activating: raw.is_activating,
    gating_items_open: openGatingItems.length,
    gating_items_total: gatingItems.length,
    blocking_item_title: blockingItemTitle,
    subtitle: null,
  };

  return { formation, template };
}
