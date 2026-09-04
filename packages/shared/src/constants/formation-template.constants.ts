// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationActionType, FormationOwnerTeam, FormationTemplateSectionKey } from '../enums';
import type { FormationTemplate } from '../interfaces';

/**
 * Recursively freezes an object graph so adding a nested object/array field later doesn't
 * silently leave it mutable — unlike a hand-walked freeze coupled to today's exact shape.
 * Tracks visited nodes in `seen` rather than skipping on `Object.isFrozen`, so a node that
 * arrives already (shallow-)frozen still has its own children walked and frozen.
 */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    Object.freeze(value);
    Object.values(value).forEach((child) => deepFreeze(child, seen));
  }
  return value;
}

/**
 * The single seeded checklist template applied to every new project formation (Epic 1, #1965).
 * No template editor exists yet (Epic 2, #1994) — this is the only template, and its content is
 * pending stakeholder review (GH-1959). Only legal/entity items may gate the formation's
 * transition to Active (not all of them do); community and launch items never gate. Bump
 * `version` alongside any content edit here once this template has shipped — see
 * `FormationTemplate.version`. Pre-release content edits (like this one) stay at v1.
 *
 * Shape adopted from the canonical `FormationTemplate` (GH-2163) — nested `sections[].items[]`,
 * snake_case keys with no `legal-`/`launch-` prefix (the prefix was a local-only convention;
 * section membership is now structural, not encoded in the key).
 *
 * Deep-frozen so the shared module-level singleton can't be mutated in place by one consumer
 * and corrupt it for every other reader.
 */
export const FORMATION_TEMPLATE: FormationTemplate = deepFreeze({
  uid: 'formation-template-default',
  version: 1,
  name: 'Project formation',
  sections: [
    {
      key: FormationTemplateSectionKey.LEGAL_AND_ENTITY,
      title: 'Legal and entity',
      // Items below with is_gating: true gate the transition to Active.
      items: [
        {
          key: 'formation_review_packet',
          title: 'Formation review and packet',
          owner_team: FormationOwnerTeam.BRAND_COUNSEL,
          action: FormationActionType.MANUAL,
          is_gating: true,
        },
        {
          key: 'preliminary_trademark_search',
          title: 'Preliminary trademark search',
          owner_team: FormationOwnerTeam.BRAND_COUNSEL,
          action: FormationActionType.MANUAL,
          is_gating: false,
        },
        {
          key: 'charter_agreed',
          title: 'Charter agreed',
          owner_team: FormationOwnerTeam.FORMATION,
          action: FormationActionType.MANUAL,
          is_gating: true,
        },
        {
          key: 'contribution_agreement',
          title: 'Contribution agreement (DocuSign)',
          owner_team: FormationOwnerTeam.FORMATION,
          action: FormationActionType.LINK,
          is_gating: true,
        },
        {
          key: 'indepth_trademark_search_series_llc',
          title: 'In-depth trademark search and Series LLC',
          owner_team: FormationOwnerTeam.BRAND_COUNSEL,
          action: FormationActionType.MANUAL,
          is_gating: true,
        },
        {
          key: 'membership_tiers',
          title: 'Membership tiers',
          owner_team: FormationOwnerTeam.PRODUCT,
          action: FormationActionType.MANUAL,
          is_gating: false,
        },
      ],
    },
    {
      key: FormationTemplateSectionKey.COMMUNITY_AND_LAUNCH,
      title: 'Community and launch',
      // Never gates.
      items: [
        {
          key: 'repositories_github_owner',
          title: 'Repositories and GitHub owner',
          owner_team: FormationOwnerTeam.COMMUNITY,
          action: FormationActionType.PROVISIONABLE,
          is_gating: false,
        },
        {
          // Provisioning, not approval — a project cannot go Active on a "pending request for
          // domain" waiting on someone else's ticket, so this is manual rather than request-shaped.
          key: 'domain_dns',
          title: 'Domain/DNS',
          owner_team: FormationOwnerTeam.IT,
          action: FormationActionType.MANUAL,
          is_gating: false,
        },
        {
          key: 'website_logo_footer',
          title: 'Website/logo/footer',
          owner_team: FormationOwnerTeam.MARKETING,
          action: FormationActionType.MANUAL,
          is_gating: false,
        },
        {
          // Same provisioning rationale as domain_dns above.
          key: 'mailing_lists',
          title: 'Mailing lists',
          owner_team: FormationOwnerTeam.COMMUNITY,
          action: FormationActionType.MANUAL,
          is_gating: false,
        },
        {
          key: 'chat_workspace',
          title: 'Chat workspace',
          owner_team: FormationOwnerTeam.IT,
          action: FormationActionType.REQUEST,
          is_gating: false,
          sub_items: [
            { key: 'chat_workspace_create', title: 'Create workspace', owner_team: FormationOwnerTeam.IT },
            { key: 'chat_workspace_channels', title: 'Configure channels', owner_team: FormationOwnerTeam.IT },
            { key: 'chat_workspace_roles', title: 'Set up roles and permissions', owner_team: FormationOwnerTeam.IT },
            { key: 'chat_workspace_onboard_admins', title: 'Onboard admins', owner_team: FormationOwnerTeam.IT },
          ],
        },
        {
          key: 'insights_access',
          title: 'Insights access',
          owner_team: FormationOwnerTeam.PRODUCT_OPS,
          action: FormationActionType.REQUEST,
          is_gating: false,
        },
        {
          key: 'asset_transfers',
          title: 'Asset transfers',
          owner_team: FormationOwnerTeam.FORMATION,
          action: FormationActionType.MANUAL,
          is_gating: false,
        },
        {
          key: 'tsc_kickoff',
          title: 'TSC and kickoff',
          owner_team: FormationOwnerTeam.COMMUNITY,
          action: FormationActionType.PROVISIONABLE,
          is_gating: false,
        },
        {
          key: 'member_join_page',
          title: 'Member join page',
          owner_team: FormationOwnerTeam.PRODUCT,
          action: FormationActionType.MANUAL,
          is_gating: false,
        },
        {
          key: 'comms',
          title: 'Launch comms',
          owner_team: FormationOwnerTeam.MARKETING,
          action: FormationActionType.MANUAL,
          is_gating: false,
        },
        // Kept as its own row rather than folded into "Launch comms" — the ticket calls out the
        // launch blog post by name as an item the 31 Aug review added and said not to drop.
        {
          key: 'blog_post',
          title: 'Launch blog post',
          owner_team: FormationOwnerTeam.MARKETING,
          action: FormationActionType.MANUAL,
          is_gating: false,
        },
      ],
    },
  ],
  // No row for "formation sets Active" — that's the derived Activating state (#1957) once every
  // is_gating: true item above is Done, not a checklist row a team completes.
} satisfies FormationTemplate);
