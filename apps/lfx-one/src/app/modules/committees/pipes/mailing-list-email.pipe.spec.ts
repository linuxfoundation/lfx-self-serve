// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MailingListEmailPipe } from './mailing-list-email.pipe';

describe('MailingListEmailPipe', () => {
  let pipe: MailingListEmailPipe;

  beforeEach(() => {
    pipe = new MailingListEmailPipe();
  });

  it('returns an address from the indexed domain even without an enriched service', () => {
    const ml = {
      group_name: 'my-list',
      domain: 'lists.example.org',
    } as GroupsIOMailingList;

    expect(pipe.transform(ml)).toBe('my-list@lists.example.org');
  });

  it('returns an empty string when the indexed domain is absent, even if the service has a domain', () => {
    const ml = {
      group_name: 'my-list',
      service: { domain: 'lists.example.org' },
    } as GroupsIOMailingList;

    expect(pipe.transform(ml)).toBe('');
  });

  it('returns an empty string for an empty domain', () => {
    const ml = {
      group_name: 'my-list',
      domain: '  ',
    } as GroupsIOMailingList;

    expect(pipe.transform(ml)).toBe('');
  });

  it('returns an empty string when the group name is absent', () => {
    const ml = {
      domain: 'lists.example.org',
    } as GroupsIOMailingList;

    expect(pipe.transform(ml)).toBe('');
  });
});
