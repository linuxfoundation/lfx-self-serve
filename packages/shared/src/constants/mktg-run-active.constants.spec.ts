// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_RUN_ACTIVE } from './mktg-run.constants';

describe('active-run conflict contract', () => {
  it('pins the scoped conflict wire code', () => {
    expect(MKTG_RUN_ACTIVE).toBe('MKTG_RUN_ACTIVE');
  });
});
