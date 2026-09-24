// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Structural invariants for the canonical formation types (GH-2163): the three seeded-template
// vocabularies are exhaustive against their expected member sets, a minimal template literal
// round-trips the shape #1959's real seeded template must produce, and — since #2709 —
// `FormationTemplateSubItem`'s "one nesting level only" invariant is asserted here at type-level
// because this package's spec files are now type-checked via `packages/shared/tsconfig.spec.json`.
// (Vitest itself is still transpile-only, so a bare type-level violation would slip past `yarn test`;
// what makes the @ts-expect-error below enforced is the tsc pass wired into `yarn check-types`.)

import { describe, expect, it } from 'vitest';

import { FORMATION_SUB_STAGE_LABELS } from '../constants/formation.constants';
import { FormationActionType, FormationOwnerTeam, FormationTemplateSectionKey } from './formation.enum';
import type { Formation, FormationItem, FormationTemplate, FormationTemplateSubItem } from '../interfaces/formation.interface';

// @ts-expect-error — Formation must not reintroduce the removed entity_type field
type FormationMustNotHaveEntityType = Formation['entity_type'];

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
  // These two derivation-input fields (#1957, GH-2163 §1) replace the removed `entity_type` field.
  // Since #2709 `check-types` now type-checks this file via `packages/shared/tsconfig.spec.json`,
  // `satisfies Formation` on the literal below gates required-field presence and nullability — a
  // required field added to `Formation` fails this test with `TS2322` on the literal. The separate
  // type assertion above guards that the removed `entity_type` key stays absent, including if it
  // were reintroduced as optional. Neither type-level check proves JSON transport preserves
  // `parent_uid: null` (JSON.stringify drops `undefined` but keeps `null`), so the round-trip
  // assertion below remains the gate for that serialization behavior.
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
      lifecycle: 'live',
      lifecycle_raw: 'live',
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
      lifecycle: 'live',
      lifecycle_raw: 'live',
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
      audience: null,
      owner: null,
      due_date: null,
      action: 'manual',
      action_href: null,
      detail: null,
      notes: null,
      evidence_link: null,
      sub_items: [],
      skip_reason: null,
      available_actions: [],
      created_at: '2026-09-08T00:00:00.000Z',
      updated_at: '2026-09-08T00:00:00.000Z',
      version: 1,
    } satisfies FormationItem;

    const roundTripped = JSON.parse(JSON.stringify(item)) as FormationItem;

    expect(roundTripped).toHaveProperty('project_uid');
    expect(roundTripped.project_uid).toBe('project-test');
  });
});

describe('FormationTemplateSubItem shape', () => {
  it('nests one level only — sub-items must not themselves carry sub_items', () => {
    // Type-only invariant with no runtime trace, enforced by the tsc pass in `yarn check-types`
    // (see #2709; `packages/shared/tsconfig.spec.json`). If `FormationTemplateSubItem` gains a
    // `sub_items` property, the `@ts-expect-error` below will fail with "Unused directive" and
    // this test stops compiling — the exact drift-catch this file is here for. The `expect()`
    // gives the `it()` a runtime observable so the whole block registers with Vitest.
    const subItem: FormationTemplateSubItem = { key: 'sub', title: 'Sub-step', owner_team: FormationOwnerTeam.IT };
    // @ts-expect-error — FormationTemplateSubItem must not carry a sub_items field of its own
    const nested = subItem.sub_items;
    expect(nested).toBeUndefined();
  });
});
