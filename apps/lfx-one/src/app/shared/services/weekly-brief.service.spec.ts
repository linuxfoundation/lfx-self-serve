// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WeeklyBriefService } from './weekly-brief.service';

/**
 * `getWeeklyBrief`'s `includeCurrentActivity` option (GH-1922) is what lets
 * weekly-brief-card.component.ts's `pollUntilTerminal` opt out of the current_activity
 * fan-out on every poll tick — see WeeklyBriefService#getCurrentBrief's (server) doc comment
 * for the upstream-cost rationale. This spec covers only the HTTP-param construction; the
 * merge-forward behavior on the client lives in weekly-brief-card.component.spec.ts.
 */
describe('WeeklyBriefService — getWeeklyBrief includeCurrentActivity (GH-1922)', () => {
  let service: WeeklyBriefService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WeeklyBriefService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WeeklyBriefService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('sends no query param at all when includeCurrentActivity is omitted (the default-included case)', () => {
    service.getWeeklyBrief('committee-1').subscribe();

    const req = http.expectOne('/api/committees/committee-1/weekly-briefs/current');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({ brief: null, throttle: null });
  });

  it('sends no query param when includeCurrentActivity is explicitly true — matches the server default rather than being redundant over the wire', () => {
    service.getWeeklyBrief('committee-1', { includeCurrentActivity: true }).subscribe();

    const req = http.expectOne('/api/committees/committee-1/weekly-briefs/current');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({ brief: null, throttle: null });
  });

  it('sends includeCurrentActivity=false only when explicitly opted out', () => {
    service.getWeeklyBrief('committee-1', { includeCurrentActivity: false }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/committees/committee-1/weekly-briefs/current');
    expect(req.request.params.get('includeCurrentActivity')).toBe('false');
    req.flush({ brief: null, throttle: null });
  });
});
