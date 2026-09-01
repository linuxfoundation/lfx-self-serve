// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { generateMockFormation, STATIC_QUEUE_FORMATIONS } from './formation-fixture.helper';

/**
 * Mirrors `isValidUrl`'s http(s)-only invariant (`packages/shared/src/utils/url.utils.ts`) without
 * importing `@lfx-one/shared/utils` — that barrel re-exports an Angular-coupled util that fails to
 * load under this server-side Vitest environment (no `@angular/compiler` available for JIT).
 */
function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

describe('generateMockFormation', () => {
  const { items } = generateMockFormation({
    projectUid: 'project-uid-1',
    projectSlug: 'test-project',
    projectName: 'Test Project',
    parentProjectUid: null,
    stage: 'Formation - Engaged',
  });

  it('gives every link/status_only item an action_href that passes the isValidUrl http(s)-only invariant', () => {
    const linkItems = items.filter((item) => item.action === 'link' || item.action === 'status_only');

    expect(linkItems.length).toBeGreaterThan(0);
    for (const item of linkItems) {
      expect(item.action_href).not.toBeNull();
      expect(isHttpUrl(item.action_href as string)).toBe(true);
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
  it('is non-empty and includes at least one row of each entity_type', () => {
    const entityTypes = new Set(STATIC_QUEUE_FORMATIONS.map((row) => row.entity_type));

    expect(STATIC_QUEUE_FORMATIONS.length).toBeGreaterThan(0);
    expect(entityTypes).toEqual(new Set(['foundation', 'subproject', 'project']));
  });
});
