// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getEntityCommands } from './entity-route.utils';

describe('getEntityCommands', () => {
  it('prefixes foundation-owned entities with /foundation', () => {
    expect(getEntityCommands('meetings', 'abc-123', true, 'edit')).toEqual(['/', 'foundation', 'meetings', 'abc-123', 'edit']);
  });

  it('prefixes regular-project entities with /project', () => {
    expect(getEntityCommands('meetings', 'abc-123', false, 'edit')).toEqual(['/', 'project', 'meetings', 'abc-123', 'edit']);
  });

  it('builds the view path when no leaf is given', () => {
    expect(getEntityCommands('groups', 'uid-1', false)).toEqual(['/', 'project', 'groups', 'uid-1']);
  });

  it('returns null when the tier is undefined so callers fall back to the flat path', () => {
    expect(getEntityCommands('meetings', 'abc-123', undefined, 'edit')).toBeNull();
  });

  it('returns null when the tier is null so callers fall back to the flat path', () => {
    expect(getEntityCommands('meetings', 'abc-123', null, 'edit')).toBeNull();
  });
});
