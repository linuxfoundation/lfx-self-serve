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
    service.markRemoved('tlf', 'microsoft-ads|c1|ag1|k1');
    expect(service.removed().has('microsoft-ads|c1|ag1|k1')).toBe(true);
  });

  it('keeps removals when the same project is reported again', () => {
    service.setScope('tlf');
    service.markRemoved('tlf', 'k1');
    service.setScope('tlf');
    expect(service.removed().has('k1')).toBe(true);
  });

  it('keeps removals recorded before the first project is reported', () => {
    service.markRemoved('tlf', 'k1');
    service.setScope('tlf');
    expect(service.removed().has('k1')).toBe(true);
  });

  it('forgets removals on a project change', () => {
    service.setScope('tlf');
    service.markRemoved('tlf', 'k1');
    service.setScope('cncf');
    expect(service.removed().size).toBe(0);
  });

  it('forgets removals when the campaigns page is released', () => {
    service.setScope('tlf');
    service.markRemoved('tlf', 'k1');
    service.releaseScope();
    expect(service.removed().size).toBe(0);
  });

  it('drops a removal that lands after the page moved to another project', () => {
    service.setScope('tlf');
    service.setScope('cncf');
    service.markRemoved('tlf', 'k1');
    expect(service.removed().size).toBe(0);
  });

  it('drops a removal that lands after the page was released', () => {
    service.setScope('tlf');
    service.releaseScope();
    service.markRemoved('tlf', 'k1');
    expect(service.removed().size).toBe(0);
  });
});
