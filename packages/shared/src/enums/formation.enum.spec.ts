// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Structural invariants for the canonical formation types (GH-2163): the three seeded-template
// vocabularies are exhaustive against their expected member sets, and a minimal template literal
// round-trips the shape #1959's real seeded template must produce.
//
// "Sub-items nest one level only" (`FormationTemplateSubItem` has no `sub_items` of its own) is a
// type-only invariant with no runtime trace, so it isn't asserted here: this package's `test`
// script is a plain `vitest run` (esbuild transpile, no type-checking) and its `check-types`
// script (`tsc --noEmit`) excludes `*.spec.ts` — neither gate command would actually catch a
// violation, so a `@ts-expect-error` here would look enforced without being enforced. The
// interface's own doc comment is this invariant's only guard.

import { describe, expect, it } from 'vitest';

import { FORMATION_SUB_STAGE_LABELS } from '../constants/formation.constants';
import { FormationActionType, FormationOwnerTeam, FormationTemplateSectionKey } from './formation.enum';
import type { Formation, FormationItem, FormationTemplate } from '../interfaces/formation.interface';

describe('FormationTemplateSectionKey', () => {
  it('is exhaustive against the two-section seeded template taxonomy', () => {
    expect(Object.values(FormationTemplateSectionKey).sort()).toEqual(['community_and_launch', 'legal_and_entity']);
  });
});

describe('FormationOwnerTeam', () => {
  it('is exhaustive against the seven-team template vocabulary, deliberately with no PMO member', () => {
    expect(Object.values(FormationOwnerTeam).sort()).toEqual(['brand_counsel', 'community', 'formation', 'it', 'marketing', 'product', 'product_ops']);
  });
});

describe('FormationActionType', () => {
  it('is exhaustive against the five action kinds, including status_only', () => {
    expect(Object.values(FormationActionType).sort()).toEqual(['link', 'manual', 'provisionable', 'request', 'status_only']);
  });
});

describe('FORMATION_SUB_STAGE_LABELS', () => {
  it('covers exactly the three canonical sub-stages, with no activating member (GH-2163 amendment)', () => {
    expect(Object.keys(FORMATION_SUB_STAGE_LABELS).sort()).toEqual(['engaged', 'exploratory', 'on_hold']);
  });
});

describe('FormationTemplate shape', () => {
  it('accepts a minimal template with one section, one item, and one sub-item', () => {
    const template = {
      uid: 'formation-template-test',
      version: 1,
      name: 'Test template',
      sections: [
        {
          key: FormationTemplateSectionKey.COMMUNITY_AND_LAUNCH,
          title: 'Community and launch',
          items: [
            {
              key: 'launch-chat-workspace',
              title: 'Chat workspace',
              is_gating: false,
              owner_team: FormationOwnerTeam.IT,
              action: FormationActionType.REQUEST,
              sub_items: [{ key: 'launch-chat-workspace-create', title: 'Create workspace', owner_team: FormationOwnerTeam.IT }],
            },
          ],
        },
      ],
    } satisfies FormationTemplate;

    expect(template.sections[0].items[0].sub_items).toHaveLength(1);
  });

  it('round-trips action_link through serialize/parse, including an unmangled {{project.uid}} placeholder', () => {
    const template = {
      uid: 'formation-template-test',
      version: 1,
      name: 'Test template',
      sections: [
        {
          key: FormationTemplateSectionKey.LEGAL_AND_ENTITY,
          title: 'Legal and entity',
          items: [
            {
              key: 'register-domain',
              title: 'Register domain',
              is_gating: false,
              owner_team: FormationOwnerTeam.IT,
              action: FormationActionType.MANUAL,
              action_link: '/project/{{project.uid}}/committees/new',
            },
            {
              key: 'contribution-agreement',
              title: 'Contribution agreement',
              is_gating: true,
              owner_team: FormationOwnerTeam.FORMATION,
              action: FormationActionType.LINK,
              action_link: 'https://example.com/docusign/envelope',
            },
            {
              key: 'charter-agreed',
              title: 'Charter agreed',
              is_gating: true,
              owner_team: FormationOwnerTeam.FORMATION,
              action: FormationActionType.MANUAL,
            },
          ],
        },
      ],
    } satisfies FormationTemplate;

    // JSON.stringify/parse of a plain string cannot itself fail — this doesn't gate a regression
    // today. It documents the actual transport boundary `action_link` crosses (an HTTP JSON
    // payload from #1957) and guards against a future step (e.g. accidental URL-encoding) that
    // would otherwise mangle the `{{project.uid}}` placeholder silently.
    const roundTripped = JSON.parse(JSON.stringify(template)) as FormationTemplate;
    const [manualItem, linkItem, noLinkItem] = roundTripped.sections[0].items;

    expect(manualItem.action_link).toBe('/project/{{project.uid}}/committees/new');
    expect(manualItem.action_link).toContain('{{project.uid}}');
    expect(linkItem.action_link).toBe('https://example.com/docusign/envelope');
    expect(noLinkItem).not.toHaveProperty('action_link');
  });
});

describe('Formation shape', () => {
  // These two derivation-input fields (#1957, GH-2163 §1) replace the removed `entity_type`
  // field. `satisfies` alone can't gate their presence or nullability — this package's `test`
  // script (vitest, esbuild transpile) doesn't type-check, and `check-types` (tsc --noEmit)
  // excludes `*.spec.ts` — so the round-trip below is the only thing that actually gates
  // `parent_uid: null` surviving JSON transport as `null` rather than being dropped the way
  // `undefined` would be. It does NOT and cannot gate that `entity_type` stays removed from the
  // type — these are plain object literals, not re-checked against `Formation` at runtime, so a
  // literal that never wrote `entity_type` proves nothing about whether the interface still has
  // it. That removal is enforced only by `yarn check-types`/`yarn build` over the non-spec sources.
  it('round-trips is_foundation and a null parent_uid (top-level project) through JSON', () => {
    const formation = {
      uid: 'formation-test',
      parent_project_uid: 'project-test',
      parent_project_slug: 'project-test-slug',
      parent_project_name: 'Project Test',
      is_foundation: true,
      parent_uid: null,
      template_uid: 'formation-template-test',
      template_version: 1,
      sub_stage: 'exploratory',
      sub_stage_raw: 'Formation - Exploratory',
      announcement_date: null,
      is_activating: false,
      gating_items_open: 1,
      gating_items_total: 1,
      blocking_item_title: null,
      subtitle: null,
      created_at: '2026-09-08T00:00:00.000Z',
      updated_at: '2026-09-08T00:00:00.000Z',
    } satisfies Formation;

    const roundTripped = JSON.parse(JSON.stringify(formation)) as Formation;

    expect(roundTripped.is_foundation).toBe(true);
    expect(roundTripped).toHaveProperty('parent_uid');
    expect(roundTripped.parent_uid).toBeNull();
  });

  it('round-trips a non-null parent_uid (nested project) through JSON', () => {
    const formation = {
      uid: 'formation-test-2',
      parent_project_uid: 'project-test-2',
      parent_project_slug: 'project-test-2-slug',
      parent_project_name: 'Project Test 2',
      is_foundation: false,
      parent_uid: 'foundation-project-uid',
      template_uid: 'formation-template-test',
      template_version: 1,
      sub_stage: 'engaged',
      sub_stage_raw: 'Formation - Engaged',
      announcement_date: null,
      is_activating: false,
      gating_items_open: 1,
      gating_items_total: 1,
      blocking_item_title: null,
      subtitle: null,
      created_at: '2026-09-08T00:00:00.000Z',
      updated_at: '2026-09-08T00:00:00.000Z',
    } satisfies Formation;

    const roundTripped = JSON.parse(JSON.stringify(formation)) as Formation;

    expect(roundTripped.is_foundation).toBe(false);
    expect(roundTripped.parent_uid).toBe('foundation-project-uid');
  });
});

describe('FormationItem shape', () => {
  it('round-trips project_uid through JSON', () => {
    const item = {
      uid: 'formation-item-test',
      formation_uid: 'formation-test',
      project_uid: 'project-test',
      template_item_key: 'launch-chat-workspace',
      section_key: 'community_and_launch',
      section_title: 'Community and launch',
      title: 'Chat workspace',
      status: 'not_started',
      is_gating: false,
      owner_team: null,
      owner: null,
      due_date: null,
      action: 'manual',
      action_href: null,
      detail: null,
      notes: null,
      links: [],
      sub_items: [],
      skip_reason: null,
      can_complete: true,
      created_at: '2026-09-08T00:00:00.000Z',
      updated_at: '2026-09-08T00:00:00.000Z',
    } satisfies FormationItem;

    const roundTripped = JSON.parse(JSON.stringify(item)) as FormationItem;

    expect(roundTripped).toHaveProperty('project_uid');
    expect(roundTripped.project_uid).toBe('project-test');
  });
});
