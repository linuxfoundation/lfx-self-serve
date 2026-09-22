// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isActiveStatus } from './org-selector.utils';

describe('isActiveStatus', () => {
  it.each(['Active', 'active', ' ACTIVE ', 'aCtIvE'])('reads %j as active whatever the casing or padding', (status) => {
    expect(isActiveStatus(status)).toBe(true);
  });

  it.each(['Expired', 'Cancelled', 'Active - Renewal', 'Inactive', '', null, undefined])('reads %j as not active', (status) => {
    expect(isActiveStatus(status)).toBe(false);
  });
});
