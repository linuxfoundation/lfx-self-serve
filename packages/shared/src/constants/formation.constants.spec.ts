// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { FORMATION_BLOCKING_CLASS, FORMATION_OPEN_GATE_CEL_FILTER } from './formation.constants';

describe('FORMATION_OPEN_GATE_CEL_FILTER (#3066/#3070)', () => {
  // Pinned literally: the service spec compares the query param against this same import, which
  // passes for any value. Skipped gates must stay admitted — `selectNextFormationGateItem` names one
  // when only skipped gates remain, since upstream still counts them as outstanding.
  it('admits every gating item not yet done, skipped included', () => {
    expect(FORMATION_OPEN_GATE_CEL_FILTER).toBe('data.gate == true && data.status != "done"');
  });
});

describe('FORMATION_BLOCKING_CLASS (#3070)', () => {
  it('maps blocked to danger and pending to amber', () => {
    expect(FORMATION_BLOCKING_CLASS).toEqual({ blocked: 'text-red-600', pending: 'text-amber-600' });
  });
});
