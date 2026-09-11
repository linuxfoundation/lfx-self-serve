// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_TEMPLATE } from '@lfx-one/shared/constants';
import { ProjectStage } from '@lfx-one/shared/enums';
import type {
  Formation,
  FormationChecklistMapContext,
  FormationItem,
  FormationItemLink,
  FormationItemMapContext,
  FormationSubItem,
  FormationSubStage,
  FormationTemplate,
  UpstreamFormationChecklist,
  UpstreamFormationItem,
} from '@lfx-one/shared/interfaces';
import { computeIsFoundation, deriveFormationBlockingItemTitle, isRelativeInAppPath, isValidUrl } from '@lfx-one/shared/utils';

/**
 * Maps `lfx-v2-formation-service`'s wire shapes (GH-2267 Phase 0's contract table, source of truth
 * `cmd/formation-api/design/design.go` at `linuxfoundation/lfx-v2-formation-service@main`) onto
 * this repo's shared types — `mapUpstreamFormationItem` for one upstream item at a time, and
 * `mapUpstreamFormationChecklist` (GH-2267 Phase 1 remainder) for the `Formation`/`FormationTemplate`
 * pair the checklist read assembles around those items. Every field this file derives rather than
 * copies verbatim (`section_title`, `action`, `action_href`, `links`, `detail`) has no upstream
 * source at all — see the GH-2267 plan's Phase 5 "checklist read" section for why each one is
 * derived from the seeded `FORMATION_TEMPLATE` instead. The raw upstream shapes themselves
 * (`UpstreamFormationItem`/`UpstreamFormationChecklist`/`FormationItemMapContext`/
 * `FormationChecklistMapContext`) live in `@lfx-one/shared/interfaces` rather than here, per this
 * repo's "no local interface in apps/lfx-one" convention.
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
    section_title: ctx.sectionTitles?.get(raw.section_key) ?? TEMPLATE_SECTION_TITLES_BY_KEY.get(raw.section_key) ?? raw.section_key,
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
 * Builds the per-project section-title map ({@link FormationItemMapContext.sectionTitles}) from
 * this checklist response's own `sections[]`. `FormationService` caches the result per project
 * (`sectionTitlesByRequestCache`) so a renamed section reads the same in the template header, the
 * checklist read's items, and every later mutation response mapped in the same request — see
 * `mapUpstreamFormationItem`'s `section_title` fallback.
 */
export function sectionTitlesFromChecklist(raw: UpstreamFormationChecklist): Map<string, string> {
  return new Map(raw.sections.map((section) => [section.key, section.title]));
}

/**
 * Maps `GET /formations/{project_uid}`'s response onto this repo's `Formation`/`FormationTemplate`
 * pair (GH-2267 Phase 1 remainder). `template` is built from the checklist's own `sections` rather
 * than the seeded `FORMATION_TEMPLATE` constant — a template revision on the service side must
 * reach the UI without a BFF redeploy. Each section's `items: []` is deliberate:
 * `FormationTemplateSection.items` is never read anywhere downstream (`groupFormationItemsBySection`
 * only reads `key`/`title`), and every per-item template fact `mapUpstreamFormationItem` needs comes
 * from `TEMPLATE_ITEMS_BY_KEY`, not from this shape. The section `key` is passed through as the
 * upstream string verbatim — no cast needed, since `FormationTemplateSection.key` is typed
 * `FormationTemplateSectionKey | string` for exactly this reason (see its doc comment); an upstream
 * section key this BFF doesn't recognize yet is a display gap (falls into `FORMATION_ORPHAN_SECTION`
 * downstream), not a type error. `template.name` still comes from the seeded `FORMATION_TEMPLATE`
 * constant — the wire shape (`UpstreamFormationChecklist`) has no template-name field to source it
 * from, only `template_uid`/`template_version`.
 *
 * `formation.uid`/`created_at`/`updated_at` are left `undefined` — all three are optional
 * specifically because the checklist read doesn't return them (see their doc comments on
 * `Formation`); synthesizing a fake `uid` here would disagree with the queue read's real
 * `formation_uid` for the same project.
 *
 * `is_foundation` is computed via the shared `computeIsFoundation` classifier rather than derived
 * from `!ctx.parentUid` — foundation status and hierarchy depth are independent axes (see
 * `deriveFormationEntityType`, which branches on both `is_foundation` and `parent_uid`
 * separately): a top-level project with no parent is not necessarily a foundation, and a foundation
 * can in principle sit under a collapsed ROOT parent. `computeIsFoundation` is the same
 * non-hierarchy-based classifier already used elsewhere in this codebase
 * (`packages/shared/src/utils/project.utils.ts`).
 *
 * `ctx.items` must be the **pre-enrichment** mapped items, not the caller's enriched response
 * array — `FormationService.enrichItems` can drop an item on an access-check failure, and this
 * rollup must reflect the checklist's real gating state regardless of that per-item enrichment
 * outcome (an enrichment hiccup on the one open gating item must not report the formation as fully
 * gated). `gating_items_open`/`gating_items_total` are computed here directly from `ctx.items`
 * rather than via the shared `deriveFormationReadinessSummary` rollup
 * (`formation-checklist.utils.ts`) — that helper treats `done` OR `skipped` as resolved, which is
 * the fixture generator's intentional escape-hatch design, but upstream's own gate accounting
 * (`lfx-v2-formation-service`'s `internal/service/progress.go#gateSummaryFromItems` and
 * `internal/service/readiness.go#isActivating`) treats a skipped gating item as still outstanding:
 * only `status === 'done'` clears a gate. The live queue's `gates_cleared` field is sourced verbatim
 * from that same upstream projection, so this live checklist path must match upstream's semantics
 * exactly rather than reuse the fixture helper — reusing it here would silently disagree with the
 * queue screen for any project with a skipped gating item, the same cross-screen-mismatch bug class
 * as the earlier `announcement_date` incident. `is_activating` is taken from `raw.is_activating`
 * verbatim rather than re-derived — see {@link Formation.is_activating}'s doc comment for why the
 * two formulas disagree and why upstream's is authoritative here.
 */
export function mapUpstreamFormationChecklist(
  raw: UpstreamFormationChecklist,
  ctx: FormationChecklistMapContext
): { formation: Formation; template: FormationTemplate } {
  const template: FormationTemplate = {
    uid: raw.template_uid,
    version: raw.template_version,
    name: FORMATION_TEMPLATE.name,
    sections: [...raw.sections].sort((a, b) => a.position - b.position).map((section) => ({ key: section.key, title: section.title, items: [] })),
  };

  const gatingItems = ctx.items.filter((item) => item.is_gating);
  const totalGatingItems = gatingItems.length;
  const openGatingItems = gatingItems.filter((item) => item.status !== 'done').length;
  const blockingItemTitle = deriveFormationBlockingItemTitle(ctx.items);

  const formation: Formation = {
    parent_project_uid: raw.project_uid,
    parent_project_slug: ctx.project.slug,
    parent_project_name: ctx.project.name,
    is_foundation: computeIsFoundation(ctx.project),
    parent_uid: ctx.parentUid,
    template_uid: raw.template_uid,
    template_version: raw.template_version,
    sub_stage: deriveFormationSubStage(ctx.project.stage),
    announcement_date: ctx.announcementDate,
    is_activating: raw.is_activating,
    gating_items_open: openGatingItems,
    gating_items_total: totalGatingItems,
    blocking_item_title: blockingItemTitle,
    subtitle: null,
  };

  return { formation, template };
}
