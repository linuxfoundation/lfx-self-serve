// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_TEMPLATE } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

// The real isValidUrl, not a hand-copied mirror: a future tightening/loosening of its guard (it
// also rejects DANGEROUS_URL_PATTERNS and short/localhost hostnames on top of the http(s) check)
// should fail this suite too. Deep-imports the single pure file rather than the `@lfx-one/shared/utils`
// barrel — that barrel re-exports Angular-dependent utils that pull in `@angular/common`'s
// `PlatformLocation`, which needs the Angular JIT compiler, unavailable under this plain-Node
// Vitest environment. A plain import (not `vi.mock`) is enough: formation-fixture.helper.ts itself
// never imports `@lfx-one/shared/utils`, so there's nothing here for a mock to intercept.
import { isValidUrl } from '@lfx-one/shared/utils/url.utils';
// Same Angular-independence reasoning as the isValidUrl deep-import above — formation.utils.ts is
// a pure file (only imports a type), so this is safe under plain-Node Vitest.
import { deriveFormationEntityType } from '@lfx-one/shared/utils/formation.utils';

import { generateMockFormation, SEEDED_FORMATION_TEMPLATE, STATIC_QUEUE_FORMATIONS } from './formation-fixture.helper';

const TEMPLATE_ITEMS = FORMATION_TEMPLATE.sections.flatMap((section) => section.items);
const TEMPLATE_GATING_COUNT = TEMPLATE_ITEMS.filter((item) => item.is_gating).length;

describe('SEEDED_FORMATION_TEMPLATE', () => {
  // Drift guard: the fixture's item/gating counts must always equal the real seeded template's —
  // this is the specific regression (#1958) this ticket fixes, and it must not silently recur.
  it("has the same section, item, and gating counts as #1959's real FORMATION_TEMPLATE", () => {
    const fixtureItems = SEEDED_FORMATION_TEMPLATE.sections.flatMap((section) => section.items);

    expect(SEEDED_FORMATION_TEMPLATE.sections.length).toBe(FORMATION_TEMPLATE.sections.length);
    expect(fixtureItems.length).toBe(TEMPLATE_ITEMS.length);
    expect(fixtureItems.filter((item) => item.is_gating).length).toBe(TEMPLATE_GATING_COUNT);
  });

  it('keeps the fixture-owned uid rather than the template-default one', () => {
    expect(SEEDED_FORMATION_TEMPLATE.uid).not.toBe(FORMATION_TEMPLATE.uid);
  });
});

describe('generateMockFormation', () => {
  const { items } = generateMockFormation({
    projectUid: 'project-uid-1',
    projectSlug: 'test-project',
    projectName: 'Test Project',
    parentProjectUid: null,
    stage: 'Formation - Engaged',
  });

  it('generates exactly one item per real template item', () => {
    expect(items.length).toBe(TEMPLATE_ITEMS.length);
  });

  it("carries each row's action_href straight from the template's action_link, defaulting to null", () => {
    for (const item of items) {
      const templateItem = TEMPLATE_ITEMS.find((candidate) => candidate.key === item.template_item_key);

      expect(item.action_href).toBe(templateItem?.action_link ?? null);
      if (item.action_href !== null) {
        expect(isValidUrl(item.action_href)).toBe(true);
      }
    }
  });
});

describe('STATIC_QUEUE_FORMATIONS', () => {
  it('covers exactly the three known entity types', () => {
    const entityTypes = new Set(STATIC_QUEUE_FORMATIONS.map((row) => deriveFormationEntityType(row)));

    expect(entityTypes).toEqual(new Set(['foundation', 'child_project', 'project']));
  });

  it("derives every row's gating_items_total from the real template rather than a hard-coded literal", () => {
    for (const row of STATIC_QUEUE_FORMATIONS) {
      expect(row.gating_items_total).toBe(TEMPLATE_GATING_COUNT);
      expect(row.gating_items_open).toBeLessThanOrEqual(row.gating_items_total);
    }
  });
});
