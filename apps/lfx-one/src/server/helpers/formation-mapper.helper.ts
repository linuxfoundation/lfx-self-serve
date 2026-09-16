// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_TEMPLATE } from '@lfx-one/shared/constants';
import type {
  Formation,
  FormationChecklistMapContext,
  FormationItem,
  FormationItemAvailableAction,
  FormationItemMapContext,
  FormationSubItem,
  FormationTemplate,
  UpstreamFormationChecklist,
  UpstreamFormationItem,
} from '@lfx-one/shared/interfaces';
import {
  computeIsFoundation,
  deriveFormationBlockingItemTitle,
  isRelativeInAppPath,
  isValidUrl,
  normalizeFormationLifecycle,
  normalizeFormationSubStage,
} from '@lfx-one/shared/utils';

/**
 * Maps `lfx-v2-formation-service`'s wire shapes (GH-2267 Phase 0's contract table, source of truth
 * `cmd/formation-api/design/design.go` at `linuxfoundation/lfx-v2-formation-service@main`) onto
 * this repo's shared types — `mapUpstreamFormationItem` for one upstream item at a time, and
 * `mapUpstreamFormationChecklist` (GH-2267 Phase 1 remainder) for the `Formation`/`FormationTemplate`
 * pair the checklist read assembles around those items. Every field this file derives rather than
 * copies verbatim (`section_title`, `action`, `action_href`, `detail`) has no upstream
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
 *
 * Exported for `FormationService.getMyFormationWork` (GH-1956): the `formation_item` index document
 * carries no `action` field either (same as the checklist read) — only `status_source`/`item_key`,
 * which this only needs, so the same derivation applies unchanged to that document shape too.
 */
export function deriveItemAction(raw: Pick<UpstreamFormationItem, 'status_source' | 'item_key'>): FormationItem['action'] {
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
 *
 * Exported for `FormationService.getMyFormationWork` (GH-1956) — the `formation_item` index
 * document's `action_link` carries the same unresolved `{{project.slug}}` placeholder and needs the
 * same substitution/validation before it can be bound into a row's `[href]`.
 */
export function resolveActionHref(actionLink: string | null | undefined, projectSlug: string): string | null {
  if (!actionLink) return null;
  const resolved = actionLink.replace(/\{\{\s*project\.slug\s*\}\}/g, projectSlug);
  if (isRelativeInAppPath(resolved) || isValidUrl(resolved)) return resolved;
  return null;
}

/** Guards a malformed `evidence_link` from ever reaching `[href]` downstream — a broken href is worse than no link (see `FormationItem.evidence_link`'s doc comment). */
function mapEvidenceLink(evidenceLink: string | null | undefined): string | null {
  if (!evidenceLink || !isValidUrl(evidenceLink)) return null;
  return evidenceLink;
}

function mapSubItems(subItems: UpstreamFormationItem['sub_items']): FormationSubItem[] {
  if (!subItems || subItems.length === 0) return [];
  return subItems.map((subItem) => ({ uid: subItem.key, title: subItem.title, status: subItem.status }));
}

/**
 * Decodes `available_actions` leniently (GH-2576) — a malformed entry (non-string `action`/
 * `requires_relation`) is dropped rather than thrown; a well-formed but *unrecognized* `action`
 * name is kept verbatim and simply never matched by any consumer's own known-action check. Neither
 * field is validated against a closed set here — see `FormationItem.available_actions`'s doc
 * comment for why.
 */
function mapAvailableActions(raw: UpstreamFormationItem['available_actions']): FormationItemAvailableAction[] {
  if (!raw) return [];
  return raw
    .filter(
      (entry): entry is FormationItemAvailableAction =>
        typeof entry?.action === 'string' && entry.action.length > 0 && typeof entry?.requires_relation === 'string'
    )
    .map((entry) => ({ action: entry.action, requires_reason: entry.requires_reason === true, requires_relation: entry.requires_relation }));
}

/**
 * Maps one upstream item onto `FormationItem`. `created_at`/`updated_at` have no upstream source on
 * this path (unlike `Formation`'s equivalent gap, this one isn't raised upstream yet since nothing
 * reads an item's own timestamps today) — the mapping time stands in rather than leaving the field
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
    evidence_link: mapEvidenceLink(raw.evidence_link),
    sub_items: mapSubItems(raw.sub_items),
    skip_reason: raw.skip_reason ?? null,
    available_actions: mapAvailableActions(raw.available_actions),
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
 * `gating_items_open`/`gating_items_total` are computed here directly from `ctx.items` (the mapped
 * items, straight off `mapUpstreamFormationItem` — mapping is synchronous and never drops one),
 * matching upstream's own gate accounting (`lfx-v2-formation-service`'s
 * `internal/service/progress.go#gateSummaryFromItems`): only `status === 'done'` clears a gate, a
 * skipped gating item is still outstanding. The live queue's `gates_cleared` field is sourced
 * verbatim from that same upstream projection, so this must match its semantics exactly to avoid
 * disagreeing with the queue screen for any project with a skipped gating item — the same
 * cross-screen-mismatch bug class as the earlier `announcement_date` incident. `is_activating` is
 * taken from `raw.is_activating` verbatim rather than re-derived — see
 * {@link Formation.is_activating}'s doc comment for the upstream formula.
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
    // `sub_stage` has no upstream field of its own on this read — `UpstreamFormationChecklist`
    // carries no stage at all — so this normalizes the NATS project record's own `stage` through
    // the same shared helper the formations queue uses (`getFormationsQueueLive`,
    // `formation.service.ts`), so the two screens can't disagree on the mapping (GH-2328).
    sub_stage: normalizeFormationSubStage(ctx.project.stage),
    sub_stage_raw: ctx.project.stage ?? '',
    // Fail-closed, unlike `sub_stage` above: `normalizeFormationLifecycle` maps anything but the 3
    // known upstream values (including a future 4th one) to `null`, and `null` renders/gates
    // read-only exactly like `'completed'`/`'frozen'` (GH-2328) — never treated as `'live'`.
    lifecycle: normalizeFormationLifecycle(raw.lifecycle),
    lifecycle_raw: raw.lifecycle ?? '',
    announcement_date: ctx.announcementDate,
    is_activating: raw.is_activating,
    gating_items_open: openGatingItems,
    gating_items_total: totalGatingItems,
    blocking_item_title: blockingItemTitle,
    subtitle: null,
  };

  return { formation, template };
}
