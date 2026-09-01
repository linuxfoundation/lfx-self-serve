// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

// isValidUrl, not a hand-copied mirror: a future tightening/loosening of its guard (it also
// rejects DANGEROUS_URL_PATTERNS and short/localhost hostnames on top of the http(s) check) should
// fail this suite too. Deep-imports the single pure file rather than `vi.importActual('@lfx-one/shared/utils')` —
// the barrel re-exports Angular-dependent utils that pull in `@angular/common`'s `PlatformLocation`,
// which needs the Angular JIT compiler, unavailable under this plain-Node Vitest environment.
// Mirrors project.service.spec.ts's identical workaround.
vi.mock('@lfx-one/shared/utils', async () => {
  const urlUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/url.utils')>(
    '../../../../../packages/shared/src/utils/url.utils'
  );
  return { isValidUrl: urlUtils.isValidUrl };
});

const { isValidUrl } = await import('@lfx-one/shared/utils');
const { generateMockFormation, STATIC_QUEUE_FORMATIONS } = await import('./formation-fixture.helper');

describe('generateMockFormation', () => {
  const { items } = generateMockFormation({
    projectUid: 'project-uid-1',
    projectSlug: 'test-project',
    projectName: 'Test Project',
    parentProjectUid: null,
    stage: 'Formation - Engaged',
  });

  it('gives every link/status_only item an action_href that passes isValidUrl', () => {
    const linkItems = items.filter((item) => item.action === 'link' || item.action === 'status_only');

    expect(linkItems.length).toBeGreaterThan(0);
    for (const item of linkItems) {
      expect(item.action_href).not.toBeNull();
      expect(isValidUrl(item.action_href as string)).toBe(true);
    }
  });

  it('gives every non-link action a null action_href', () => {
    const nonLinkItems = items.filter((item) => item.action !== 'link' && item.action !== 'status_only');

    expect(nonLinkItems.length).toBeGreaterThan(0);
    for (const item of nonLinkItems) {
      expect(item.action_href).toBeNull();
    }
  });
});

describe('STATIC_QUEUE_FORMATIONS', () => {
  it('covers exactly the three known entity_type values', () => {
    const entityTypes = new Set(STATIC_QUEUE_FORMATIONS.map((row) => row.entity_type));

    expect(STATIC_QUEUE_FORMATIONS.length).toBeGreaterThan(0);
    expect(entityTypes).toEqual(new Set(['foundation', 'subproject', 'project']));
  });
});
