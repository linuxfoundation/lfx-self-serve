// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { FormationOwnerTeam, FormationTemplateSectionKey } from '../enums';
import type { FormationTemplateItem, FormationTemplateSection, FormationTemplateSubItem } from '../interfaces';

import { FORMATION_TEMPLATE } from './formation-template.constants';

/**
 * Structural validation of the seeded formation checklist template (GH-1959/GH-2163). Content
 * (titles/owners/action types, especially the chat-workspace sub-item names) is a draft pending
 * stakeholder review. The content fingerprint below is the primary place that pins today's draft
 * data (and forces a conscious version bump alongside any edit to it) and the gating-id list
 * gives that one behaviorally-significant fact (which items block Active) its own named failure;
 * every other test asserts a structural invariant that must hold for any future content — with
 * one exception: dropping the last item owned by a given team also fails owner-team coverage.
 */
describe('FORMATION_TEMPLATE', () => {
  const allItems = (): FormationTemplateItem[] => FORMATION_TEMPLATE.sections.flatMap((section) => section.items);

  // Bumping `version` alongside a content edit made after this template has shipped is a
  // documented convention, not something a test can enforce on its own — so pin a fingerprint of
  // every field the version contract covers. Editing a title, reordering items, or changing an
  // owner/action/gate touches this fingerprint, forcing a conscious visit to this test (and, once
  // shipped, the version bump) rather than passing silently. Pre-release edits stay at v1.
  it('pins the v1 content fingerprint — bump `version` above once this needs to change post-ship', () => {
    const subItemFingerprint = (subItem: FormationTemplateSubItem): string => [subItem.key, subItem.title, subItem.owner_team].join('|');
    const itemFingerprint = (item: FormationTemplateItem): string =>
      [item.key, item.title, item.owner_team, item.action, item.is_gating, (item.sub_items ?? []).map(subItemFingerprint).join(',')].join('|');
    const sectionFingerprint = (section: FormationTemplateSection): string =>
      `${section.key}::${section.title}::[${section.items.map(itemFingerprint).join(';')}]`;

    expect(FORMATION_TEMPLATE.version).toBe(1);
    expect(FORMATION_TEMPLATE.name).toBe('Project formation');
    expect(FORMATION_TEMPLATE.sections.map(sectionFingerprint)).toEqual([
      'legal_and_entity::Legal and entity::[' +
        [
          'formation_review_packet|Formation review and packet|brand_counsel|manual|true|',
          'preliminary_trademark_search|Preliminary trademark search|brand_counsel|manual|false|',
          'charter_agreed|Charter agreed|formation|manual|true|',
          'contribution_agreement|Contribution agreement (DocuSign)|formation|link|true|',
          'indepth_trademark_search_series_llc|In-depth trademark search and Series LLC|brand_counsel|manual|true|',
          'membership_tiers|Membership tiers|product|manual|false|',
        ].join(';') +
        ']',
      'community_and_launch::Community and launch::[' +
        [
          'repositories_github_owner|Repositories and GitHub owner|community|provisionable|false|',
          'domain_dns|Domain/DNS|it|manual|false|',
          'website_logo_footer|Website/logo/footer|marketing|manual|false|',
          'mailing_lists|Mailing lists|community|manual|false|',
          'chat_workspace|Chat workspace|it|request|false|chat_workspace_create|Create workspace|it,chat_workspace_channels|Configure channels|it,chat_workspace_roles|Set up roles and permissions|it,chat_workspace_onboard_admins|Onboard admins|it',
          'insights_access|Insights access|product_ops|request|false|',
          'asset_transfers|Asset transfers|formation|manual|false|',
          'tsc_kickoff|TSC and kickoff|community|provisionable|false|',
          'member_join_page|Member join page|product|manual|false|',
          'comms|Launch comms|marketing|manual|false|',
          'blog_post|Launch blog post|marketing|manual|false|',
        ].join(';') +
        ']',
    ]);
  });

  const allKeys = (): string[] => [...allItems().map((item) => item.key), ...allItems().flatMap((item) => item.sub_items?.map((subItem) => subItem.key) ?? [])];

  it('has no duplicate keys across items and sub-items', () => {
    const keys = allKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every item and sub-item a non-empty title', () => {
    const untitled = allItems()
      .flatMap((item) => [item, ...(item.sub_items ?? [])])
      .filter((item) => item.title.trim() === '');
    expect(untitled).toEqual([]);
  });

  // Explicit counts (GH-1959 scope trim, re-verified after the GH-2163 canonical-types adoption)
  // called out by the ticket's acceptance criteria. Already implied by the fingerprint and
  // gating-id assertions above, but named here so a count drift fails with its own diagnostic
  // instead of only showing up as an opaque array diff.
  it('has exactly 17 items, 4 of them gating', () => {
    expect(allItems().length).toBe(17);
    expect(allItems().filter((item) => item.is_gating).length).toBe(4);
  });

  // The core acceptance criterion: gate flags only ever appear on legal/entity items. A rule
  // for any future content, not a fact about today's rows — so it stays even as the fingerprint
  // above changes.
  it('never gates a community/launch item', () => {
    const gatedLaunchItems = FORMATION_TEMPLATE.sections
      .filter((section) => section.key === FormationTemplateSectionKey.COMMUNITY_AND_LAUNCH)
      .flatMap((section) => section.items)
      .filter((item) => item.is_gating);
    expect(gatedLaunchItems).toEqual([]);
  });

  // Named separately from the fingerprint above so an unintended gate flip fails with a
  // diagnostic naming the specific gating set the ticket specifies, not just an opaque array
  // diff — gate correctness has a real downstream consequence (blocking the formation's
  // transition to Active).
  it('gates exactly the items the ticket calls out as gating', () => {
    const gatingKeys = allItems()
      .filter((item) => item.is_gating)
      .map((item) => item.key);

    expect(gatingKeys.sort()).toEqual(['formation_review_packet', 'charter_agreed', 'contribution_agreement', 'indepth_trademark_search_series_llc'].sort());
  });

  it('exercises every owner team the enum defines, including on sub-items', () => {
    const usedTeams = new Set(allItems().flatMap((item) => [item.owner_team, ...(item.sub_items ?? []).map((subItem) => subItem.owner_team)]));

    // Derived from the enum, not hardcoded, so a team added to FormationOwnerTeam that no
    // item actually uses fails here instead of passing unnoticed.
    expect([...usedTeams].sort()).toEqual(Object.values(FormationOwnerTeam).sort());
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
