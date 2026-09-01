// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Which half of the seeded formation checklist a template item belongs to. Only legal/entity
 * items may gate the formation's transition to Active (not all of them do — see
 * `FormationTemplateItem.gate`); community and launch items never gate.
 */
export enum FormationTemplateSection {
  LEGAL_AND_ENTITY = 'legal_and_entity',
  COMMUNITY_AND_LAUNCH = 'community_and_launch',
}

/**
 * Team responsible for completing a formation checklist item. Values are stable identifiers,
 * not display labels — once the formation service (#1957) persists these, a wording change
 * (e.g. "Product Ops" -> "Program Ops") must stay a display-layer edit, not a data migration.
 *
 * Deliberately has no PMO member — PMO/umbrella onboarding is out of scope for this template
 * (GH-1959).
 */
export enum FormationItemOwnerTeam {
  FORMATION = 'formation',
  BRAND_COUNSEL = 'brand_counsel',
  COMMUNITY = 'community',
  IT = 'it',
  MARKETING = 'marketing',
  PRODUCT_OPS = 'product_ops',
  PRODUCT = 'product',
}

/** How a formation checklist item is completed. */
export enum FormationItemActionType {
  /** The owning team checks this off by hand once the real-world work is done. */
  MANUAL = 'manual',
  /** Completing the item means following a link (e.g. signing a DocuSign envelope). */
  LINK = 'link',
  /** LFX can create/configure the resource itself — no other team needs to be asked. */
  PROVISIONABLE = 'provisionable',
  /** Completing the item means filing a request with another team (e.g. IT) and waiting on it. */
  REQUEST = 'request',
}
