// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { FormationItemOwnerTeam, FormationTemplateSection } from '../enums';
import type { FormationTemplateItem, FormationTemplateSubItem } from '../interfaces';

import { FORMATION_TEMPLATE } from './formation-template.constants';

/**
 * Structural validation of the seeded formation checklist template (GH-1959). Content
 * (titles/owners/action types, especially the chat-workspace sub-item names) is a draft pending
 * stakeholder review. The content fingerprint below is the primary place that pins today's draft
 * data (and forces a conscious version bump alongside any edit to it) and the gating-id list
 * gives that one behaviorally-significant fact (which items block Active) its own named failure;
 * every other test asserts a structural invariant that must hold for any future content — with
 * one exception: dropping the last item owned by a given team also fails owner-team coverage.
 */
describe('FORMATION_TEMPLATE', () => {
  // Bumping `version` alongside a content edit is a documented convention, not something a test
  // can enforce on its own — so pin a fingerprint of every field the version contract covers.
  // Editing a title, reordering items, or changing an owner/action/gate touches this fingerprint,
  // forcing a conscious visit to this test (and the version bump) rather than passing silently.
  it('pins the v1 content fingerprint — bump `version` above when this needs to change', () => {
    const subItemFingerprint = (subItem: FormationTemplateSubItem): string => [subItem.id, subItem.title, subItem.ownerTeam].join('|');
    const itemFingerprint = (item: FormationTemplateItem): string =>
      [item.id, item.title, item.section, item.ownerTeam, item.actionType, item.gate, (item.subItems ?? []).map(subItemFingerprint).join(',')].join('|');

    expect(FORMATION_TEMPLATE.version).toBe(1);
    expect(FORMATION_TEMPLATE.items.map(itemFingerprint)).toEqual([
      'legal-formation-review-packet|Formation review and packet|legal_and_entity|brand_counsel|manual|true|',
      'legal-preliminary-trademark-search|Preliminary trademark search|legal_and_entity|brand_counsel|manual|false|',
      'legal-charter-agreed|Charter agreed|legal_and_entity|formation|manual|true|',
      'legal-contribution-agreement|Contribution agreement (DocuSign)|legal_and_entity|formation|link|true|',
      'legal-indepth-trademark-search-series-llc|In-depth trademark search and Series LLC|legal_and_entity|brand_counsel|manual|true|',
      'legal-membership-tiers|Membership tiers|legal_and_entity|product|manual|false|',
      'launch-repositories-github-owner|Repositories and GitHub owner|community_and_launch|community|provisionable|false|',
      'launch-domain-dns|Domain/DNS|community_and_launch|it|request|false|',
      'launch-website-logo-footer|Website/logo/footer|community_and_launch|marketing|manual|false|',
      'launch-mailing-lists|Mailing lists|community_and_launch|community|provisionable|false|',
      'launch-chat-workspace|Chat workspace|community_and_launch|it|request|false|launch-chat-workspace-create|Create workspace|it,launch-chat-workspace-channels|Configure channels|it,launch-chat-workspace-roles|Set up roles and permissions|it,launch-chat-workspace-onboard-admins|Onboard admins|it',
      'launch-insights-access|Insights access|community_and_launch|product_ops|request|false|',
      'launch-asset-transfers|Asset transfers|community_and_launch|formation|manual|false|',
      'launch-tsc-kickoff|TSC and kickoff|community_and_launch|community|provisionable|false|',
      'launch-member-join-page|Member join page|community_and_launch|product|manual|false|',
      'launch-comms|Launch comms|community_and_launch|marketing|manual|false|',
      'launch-blog-post|Launch blog post|community_and_launch|marketing|manual|false|',
    ]);
  });

  const allIds = (): string[] => [
    ...FORMATION_TEMPLATE.items.map((item) => item.id),
    ...FORMATION_TEMPLATE.items.flatMap((item) => item.subItems?.map((subItem) => subItem.id) ?? []),
  ];

  it('has no duplicate ids across items and sub-items', () => {
    const ids = allIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every item and sub-item a non-empty title', () => {
    const untitled = FORMATION_TEMPLATE.items.flatMap((item) => [item, ...(item.subItems ?? [])]).filter((item) => item.title.trim() === '');
    expect(untitled).toEqual([]);
  });

  // Explicit counts (GH-1959 scope trim) so a future item added/removed without updating this test
  // fails loudly, independent of the fingerprint's array length.
  it('has exactly 17 items, 4 of them gating', () => {
    expect(FORMATION_TEMPLATE.items.length).toBe(17);
    expect(FORMATION_TEMPLATE.items.filter((item) => item.gate).length).toBe(4);
  });

  // The core acceptance criterion: gate flags only ever appear on legal/entity items. A rule
  // for any future content, not a fact about today's rows — so it stays even as the fingerprint
  // above changes.
  it('never gates a community/launch item', () => {
    const gatedLaunchItems = FORMATION_TEMPLATE.items.filter((item) => item.section === FormationTemplateSection.COMMUNITY_AND_LAUNCH && item.gate);
    expect(gatedLaunchItems).toEqual([]);
  });

  // Named separately from the fingerprint above so an unintended gate flip fails with a
  // diagnostic naming the specific gating set the ticket specifies, not just an opaque array
  // diff — gate correctness has a real downstream consequence (blocking the formation's
  // transition to Active).
  it('gates exactly the items the ticket calls out as gating', () => {
    const gatingIds = FORMATION_TEMPLATE.items.filter((item) => item.gate).map((item) => item.id);

    expect(gatingIds.sort()).toEqual(
      ['legal-formation-review-packet', 'legal-charter-agreed', 'legal-contribution-agreement', 'legal-indepth-trademark-search-series-llc'].sort()
    );
  });

  it('exercises every owner team the enum defines, including on sub-items', () => {
    const usedTeams = new Set(FORMATION_TEMPLATE.items.flatMap((item) => [item.ownerTeam, ...(item.subItems ?? []).map((subItem) => subItem.ownerTeam)]));

    // Derived from the enum, not hardcoded, so a team added to FormationItemOwnerTeam that no
    // item actually uses fails here instead of passing unnoticed.
    expect([...usedTeams].sort()).toEqual(Object.values(FormationItemOwnerTeam).sort());
  });

  it('deep-freezes the template so a consumer cannot mutate the shared singleton', () => {
    // Walks the whole object graph rather than naming specific fields, so it keeps covering the
    // freeze guarantee even if FormationTemplateItem later gains another nested object or array.
    const isDeepFrozen = (value: unknown): boolean => {
      if (value === null || typeof value !== 'object') return true;
      if (!Object.isFrozen(value)) return false;
      return Object.values(value).every(isDeepFrozen);
    };

    expect(isDeepFrozen(FORMATION_TEMPLATE)).toBe(true);
  });
});
