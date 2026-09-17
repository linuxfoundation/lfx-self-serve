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
 * `status_source: 'platform'` means `provisionable`, EXCEPT for an item whose seeded template action
 * is `status_only` (GH-2267 Phase 5, tightened GH-2613 review). For every other template action the
 * platform override still applies regardless of what the template says — LFX itself provisioned/
 * checked the resource, so the row is never a manual/link/request affordance while that's true.
 *
 * The `status_only` exception exists because the override is not one-way-safe for that action kind.
 * `internal/service/item_status.go` at `lfx-v2-formation-service` v0.1.4: a manual status write flips
 * an item's `status_source` to `manual` permanently ("Nothing sets it back to platform: once a person
 * has ruled on a row..."). `buildStatusMenuItems`/`isStatusEditable`
 * (`formation-checklist-row.component.ts`) hide the status menu once an item's *current* derived
 * `action` is `status_only` — but before that, while the same item still reports `status_source:
 * 'platform'`, the unconditional override here would render it `provisionable` instead, which does
 * show the menu. A human using that menu to set status manually would flip `status_source` to
 * `manual` upstream; the next read would then fall through to this item's real seeded `status_only`
 * action and permanently hide the menu — stranding the item at whatever non-terminal status the human
 * just set it to, with no client-visible way to advance or reopen it again. Keeping a `status_only`-
 * templated item `status_only` regardless of a transient `platform` status_source closes that hole:
 * the menu never shows for it in the first place, so the one-way manual write that would strand it
 * can never be triggered through this UI.
 *
 * Anything else falls back to the template's own `action` by `item_key`; an item_key the template
 * doesn't know (a future upstream addition this BFF hasn't been updated for) defaults to `'manual'`
 * rather than throwing, since a checklist row missing its action affordance is a display gap, not a
 * fatal one.
 *
 * Exported for `FormationService.getMyFormationWork` (GH-1956): the `formation_item` index document
 * carries no `action` field either (same as the checklist read) — only `status_source`/`item_key`,
 * which this only needs, so the same derivation applies unchanged to that document shape too.
 */
export function deriveItemAction(raw: Pick<UpstreamFormationItem, 'status_source' | 'item_key'>): FormationItem['action'] {
  const templateAction = TEMPLATE_ITEMS_BY_KEY.get(raw.item_key)?.action ?? 'manual';
  if (raw.status_source === 'platform' && templateAction !== 'status_only') return 'provisionable';
  return templateAction;
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
 * `requires_relation`, non-boolean `requires_reason`) is dropped rather than thrown or silently
 * coerced, and so is the whole field when upstream sends something other than an array; a
 * well-formed but *unrecognized* `action` name is kept verbatim and simply never matched by any
 * consumer's own known-action check. Neither `action` nor `requires_relation` is validated against a
 * closed set here — see `FormationItem.available_actions`'s doc comment for why. `requires_reason`
 * IS type-checked (unlike the other two, it has no open-vocabulary reason to tolerate a wrong type):
 * a malformed value drops the whole entry rather than defaulting to `false`, since silently turning
 * a reason-required action reasonless is worse than omitting it (GH-2576 review).
 */
function mapAvailableActions(raw: UpstreamFormationItem['available_actions']): FormationItemAvailableAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is FormationItemAvailableAction =>
      typeof entry?.action === 'string' &&
      entry.action.length > 0 &&
      typeof entry?.requires_relation === 'string' &&
      typeof entry?.requires_reason === 'boolean'
  );
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
