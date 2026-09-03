// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationItemActionType, FormationItemOwnerTeam, FormationTemplateSection } from '../enums';
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
 * `version` alongside any content edit here — see `FormationTemplate.version`.
 *
 * Deep-frozen so the shared module-level singleton can't be mutated in place by one consumer
 * and corrupt it for every other reader.
 */
export const FORMATION_TEMPLATE: FormationTemplate = deepFreeze({
  id: 'formation-template-default',
  version: 1,
  items: [
    // Legal and entity — the items below with gate: true gate the transition to Active
    {
      id: 'legal-formation-review-packet',
      title: 'Formation review and packet',
      section: FormationTemplateSection.LEGAL_AND_ENTITY,
      ownerTeam: FormationItemOwnerTeam.BRAND_COUNSEL,
      actionType: FormationItemActionType.MANUAL,
      gate: true,
    },
    {
      id: 'legal-preliminary-trademark-search',
      title: 'Preliminary trademark search',
      section: FormationTemplateSection.LEGAL_AND_ENTITY,
      ownerTeam: FormationItemOwnerTeam.BRAND_COUNSEL,
      actionType: FormationItemActionType.MANUAL,
      gate: false,
    },
    {
      id: 'legal-charter-agreed',
      title: 'Charter agreed',
      section: FormationTemplateSection.LEGAL_AND_ENTITY,
      ownerTeam: FormationItemOwnerTeam.FORMATION,
      actionType: FormationItemActionType.MANUAL,
      gate: true,
    },
    {
      id: 'legal-contribution-agreement',
      title: 'Contribution agreement (DocuSign)',
      section: FormationTemplateSection.LEGAL_AND_ENTITY,
      ownerTeam: FormationItemOwnerTeam.FORMATION,
      actionType: FormationItemActionType.LINK,
      gate: true,
    },
    {
      id: 'legal-indepth-trademark-search-series-llc',
      title: 'In-depth trademark search and Series LLC',
      section: FormationTemplateSection.LEGAL_AND_ENTITY,
      ownerTeam: FormationItemOwnerTeam.BRAND_COUNSEL,
      actionType: FormationItemActionType.MANUAL,
      gate: true,
    },
    {
      id: 'legal-membership-tiers',
      title: 'Membership tiers',
      section: FormationTemplateSection.LEGAL_AND_ENTITY,
      ownerTeam: FormationItemOwnerTeam.PRODUCT,
      actionType: FormationItemActionType.MANUAL,
      gate: false,
    },

    // Community and launch — never gates
    {
      id: 'launch-repositories-github-owner',
      title: 'Repositories and GitHub owner',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.COMMUNITY,
      actionType: FormationItemActionType.PROVISIONABLE,
      gate: false,
    },
    {
      id: 'launch-domain-dns',
      title: 'Domain/DNS',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.IT,
      actionType: FormationItemActionType.REQUEST,
      gate: false,
    },
    {
      id: 'launch-website-logo-footer',
      title: 'Website/logo/footer',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.MARKETING,
      actionType: FormationItemActionType.MANUAL,
      gate: false,
    },
    {
      id: 'launch-mailing-lists',
      title: 'Mailing lists',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.COMMUNITY,
      actionType: FormationItemActionType.PROVISIONABLE,
      gate: false,
    },
    {
      id: 'launch-chat-workspace',
      title: 'Chat workspace',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.IT,
      actionType: FormationItemActionType.REQUEST,
      gate: false,
      subItems: [
        { id: 'launch-chat-workspace-create', title: 'Create workspace', ownerTeam: FormationItemOwnerTeam.IT },
        { id: 'launch-chat-workspace-channels', title: 'Configure channels', ownerTeam: FormationItemOwnerTeam.IT },
        { id: 'launch-chat-workspace-roles', title: 'Set up roles and permissions', ownerTeam: FormationItemOwnerTeam.IT },
        { id: 'launch-chat-workspace-onboard-admins', title: 'Onboard admins', ownerTeam: FormationItemOwnerTeam.IT },
      ],
    },
    {
      id: 'launch-insights-access',
      title: 'Insights access',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.PRODUCT_OPS,
      actionType: FormationItemActionType.REQUEST,
      gate: false,
    },
    {
      id: 'launch-asset-transfers',
      title: 'Asset transfers',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.FORMATION,
      actionType: FormationItemActionType.MANUAL,
      gate: false,
    },
    {
      id: 'launch-tsc-kickoff',
      title: 'TSC and kickoff',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.COMMUNITY,
      actionType: FormationItemActionType.PROVISIONABLE,
      gate: false,
    },
    {
      id: 'launch-member-join-page',
      title: 'Member join page',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.PRODUCT,
      actionType: FormationItemActionType.MANUAL,
      gate: false,
    },
    {
      id: 'launch-comms',
      title: 'Launch comms',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.MARKETING,
      actionType: FormationItemActionType.MANUAL,
      gate: false,
    },
    // Kept as its own row rather than folded into "Launch comms" — the ticket calls out the
    // launch blog post by name as an item the 31 Aug review added and said not to drop.
    {
      id: 'launch-blog-post',
      title: 'Launch blog post',
      section: FormationTemplateSection.COMMUNITY_AND_LAUNCH,
      ownerTeam: FormationItemOwnerTeam.MARKETING,
      actionType: FormationItemActionType.MANUAL,
      gate: false,
    },
  ],
  // No row for "formation sets Active" — that's the derived Activating state (#1957) once every
  // gate: true item above is Done, not a checklist row a team completes.
} satisfies FormationTemplate);
