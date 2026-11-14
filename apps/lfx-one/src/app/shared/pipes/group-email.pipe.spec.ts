// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { GroupEmailPipe } from './group-email.pipe';

describe('GroupEmailPipe', () => {
  const pipe = new GroupEmailPipe();

  it('formats the indexed domain without requiring the parent service', () => {
    expect(pipe.transform({ group_name: 'main', domain: 'lists.example.org' } as GroupsIOMailingList)).toBe('main@lists.example.org');
  });

  it('uses the indexed group name rather than a different name in the parent URL', () => {
    expect(
      pipe.transform({ group_name: 'main', domain: 'lists.example.org', service: { url: 'https://lists.example.org/g/another-list' } } as GroupsIOMailingList)
    ).toBe('main@lists.example.org');
  });

  it('does not fabricate an address when the indexed domain is missing or empty', () => {
    expect(pipe.transform({ group_name: 'main' } as GroupsIOMailingList)).toBe('');
    expect(pipe.transform({ group_name: 'main', domain: '' } as GroupsIOMailingList)).toBe('');
  });
});
