// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Which section of the seeded formation checklist template a template item belongs to (GH-2163).
 * Renamed from GH-1959's original `FormationTemplateSection` so it stops colliding with the
 * structural interface of the same name in `formation.interface.ts` — that interface's `key`
 * field is typed with this enum (`FormationTemplateSection['key']`). Only legal/entity items may
 * gate the formation's transition to Active (not all of them do — see
 * `FormationTemplateItem.is_gating`); community and launch items never gate.
 */
export enum FormationTemplateSectionKey {
  LEGAL_AND_ENTITY = 'legal_and_entity',
  COMMUNITY_AND_LAUNCH = 'community_and_launch',
}

/**
 * Team responsible for completing a formation checklist template item. Values are stable
 * identifiers, not display labels — once the formation service (#1957) persists these, a wording
 * change (e.g. "Product Ops" -> "Program Ops") must stay a display-layer edit, not a data
 * migration. Scoped to the *template* (`FormationTemplateItem.owner_team` /
 * `FormationTemplateSubItem.owner_team`) — the runtime `FormationItem.owner_team` stays a plain
 * string until #1957 confirms its live vocabulary (see that field's doc comment).
 *
 * Deliberately has no PMO member — PMO/umbrella onboarding is out of scope for this template
 * (GH-1959).
 */
export enum FormationOwnerTeam {
  FORMATION = 'formation',
  BRAND_COUNSEL = 'brand_counsel',
  COMMUNITY = 'community',
  IT = 'it',
  MARKETING = 'marketing',
  PRODUCT_OPS = 'product_ops',
  PRODUCT = 'product',
}

/**
 * How a formation checklist item is completed. Carries GH-1958's `STATUS_ONLY` in addition to
 * GH-1959's original four members — `status_only` rows never expose how the underlying tooling
 * was set up (manual vs automated), only Done/pending plus an optional link.
 */
export enum FormationActionType {
  /** The owning team checks this off by hand once the real-world work is done. */
  MANUAL = 'manual',
  /** Completing the item means following a link (e.g. signing a DocuSign envelope). */
  LINK = 'link',
  /** LFX can create/configure the resource itself — no other team needs to be asked. */
  PROVISIONABLE = 'provisionable',
  /** Completing the item means filing a request with another team (e.g. IT) and waiting on it. */
  REQUEST = 'request',
  /** Status-only row — Done/pending plus an optional link, no visibility into how it was set up. */
  STATUS_ONLY = 'status_only',
}
