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

  it('returns a mailto-ready email address when service domain is present', () => {
    const ml = {
      group_name: 'my-list',
      service: { domain: 'lists.example.org' },
    } as GroupsIOMailingList;

    expect(pipe.transform(ml)).toBe('my-list@lists.example.org');
  });

  it('returns an empty string when service domain is absent', () => {
    const ml = {
      group_name: 'my-list',
      service: {},
    } as GroupsIOMailingList;

    expect(pipe.transform(ml)).toBe('');
  });

  it('returns an empty string when service is null', () => {
    const ml = {
      group_name: 'my-list',
      service: null,
    } as unknown as GroupsIOMailingList;

    expect(pipe.transform(ml)).toBe('');
  });

  it('returns an empty string when service is undefined', () => {
    const ml = {
      group_name: 'my-list',
    } as GroupsIOMailingList;

    expect(pipe.transform(ml)).toBe('');
  });
});
