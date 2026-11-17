// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MailingListSyncMode } from '@lfx-one/shared/enums';
import { MailingListDirectionConflict } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MailingListDirectionOptionsPipe } from './mailing-list-direction-options.pipe';

describe('MailingListDirectionOptionsPipe', () => {
  let pipe: MailingListDirectionOptionsPipe;

  const baseOptions = [
    { label: 'Mailing List → Committee', value: MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE },
    { label: 'Committee → Mailing List', value: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST },
  ];

  beforeEach(() => {
    pipe = new MailingListDirectionOptionsPipe();
  });

  it('disables neither option when there is no conflict', () => {
    const result = pipe.transform(baseOptions, undefined);

    expect(result.find((o) => o.value === MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE)?.disabled).toBe(false);
    expect(result.find((o) => o.value === MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST)?.disabled).toBe(false);
  });

  it('disables only Mailing List → Committee when a sibling already runs Committee → Mailing List', () => {
    const conflict: MailingListDirectionConflict = { mlToCUid: null, cToMlUid: 'sibling-uid' };

    const result = pipe.transform(baseOptions, conflict);

    expect(result.find((o) => o.value === MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE)?.disabled).toBe(true);
    expect(result.find((o) => o.value === MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST)?.disabled).toBe(false);
  });

  it('disables both directions when a sibling already runs Mailing List → Committee', () => {
    const conflict: MailingListDirectionConflict = { mlToCUid: 'sibling-uid', cToMlUid: null };

    const result = pipe.transform(baseOptions, conflict);

    expect(result.find((o) => o.value === MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE)?.disabled).toBe(true);
    expect(result.find((o) => o.value === MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST)?.disabled).toBe(true);
  });

  it('leaves non-auto options (e.g. Manual) untouched by either conflict type', () => {
    const optionsWithManual = [...baseOptions, { label: 'Manual', value: MailingListSyncMode.MANUAL }];
    const conflict: MailingListDirectionConflict = { mlToCUid: 'sibling-uid', cToMlUid: null };

    const result = pipe.transform(optionsWithManual, conflict);

    expect(result.find((o) => o.value === MailingListSyncMode.MANUAL)?.disabled).toBe(false);
  });
});
