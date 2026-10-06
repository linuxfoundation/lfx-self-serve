// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { CampaignRemovedKeywordsService } from './campaign-removed-keywords.service';

describe('CampaignRemovedKeywordsService', () => {
  let service: CampaignRemovedKeywordsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CampaignRemovedKeywordsService);
  });

  it('remembers a confirmed removal', () => {
    service.markRemoved('microsoft-ads|c1|ag1|k1');
    expect(service.removed().has('microsoft-ads|c1|ag1|k1')).toBe(true);
  });

  it('keeps removals when the same scope is reported again', () => {
    service.setScope('tlf', 'b1');
    service.markRemoved('k1');
    service.setScope('tlf', 'b1');
    expect(service.removed().has('k1')).toBe(true);
  });

  it('keeps removals recorded before the first scope is reported', () => {
    service.markRemoved('k1');
    service.setScope('tlf', 'b1');
    expect(service.removed().has('k1')).toBe(true);
  });

  it('forgets removals on a project or brief change', () => {
    service.setScope('tlf', 'b1');
    service.markRemoved('k1');
    service.setScope('tlf', 'b2');
    expect(service.removed().size).toBe(0);
  });

  it('forgets removals when the campaigns page is released', () => {
    service.setScope('tlf', 'b1');
    service.markRemoved('k1');
    service.releaseScope();
    expect(service.removed().size).toBe(0);
  });
});
