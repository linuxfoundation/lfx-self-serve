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
import type { FormationTemplate } from '../interfaces/formation.interface';

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

    const roundTripped = JSON.parse(JSON.stringify(template)) as FormationTemplate;
    const [manualItem, linkItem, noLinkItem] = roundTripped.sections[0].items;

    expect(manualItem.action_link).toBe('/project/{{project.uid}}/committees/new');
    expect(manualItem.action_link).toContain('{{project.uid}}');
    expect(linkItem.action_link).toBe('https://example.com/docusign/envelope');
    expect(noLinkItem).not.toHaveProperty('action_link');
  });
});
