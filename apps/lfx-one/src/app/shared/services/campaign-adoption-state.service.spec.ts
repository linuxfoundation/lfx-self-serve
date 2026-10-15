// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { CampaignAdoptionStateService } from './campaign-adoption-state.service';

describe('CampaignAdoptionStateService (#3299)', () => {
  const failure = { state: 'unconfirmed' as const, title: 'Adoption not confirmed', message: 'm', detail: '' };

  it('keys by project, platform and platform campaign id, and keeps an entry until it is settled', () => {
    const store = TestBed.inject(CampaignAdoptionStateService);
    const key = CampaignAdoptionStateService.key('tlf', 'reddit-ads', 't2_x');
    const entry = store.entry(key);

    store.markPending(key, 'b-1');
    expect(entry()).toEqual({ state: 'pending', briefId: 'b-1', failure: null });
    expect(store.entry(CampaignAdoptionStateService.key('cncf', 'reddit-ads', 't2_x'))()).toBeNull();

    store.markUnconfirmed(key, 'b-1', failure);
    store.annotate(key, 'checked, still unknown');
    expect(entry()?.failure?.detail).toBe('checked, still unknown');

    store.markAdopted(key, 'b-1');
    expect(entry()).toEqual(expect.objectContaining({ state: 'adopted', briefId: 'b-1', adoptedAt: expect.any(String) }));

    store.settle(key);
    expect(entry()).toBeNull();
  });
});
