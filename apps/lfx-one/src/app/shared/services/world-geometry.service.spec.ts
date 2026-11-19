// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorldGeometryService } from './world-geometry.service';

import type { HealthMetricsWorldGeometry } from '@lfx-one/shared/interfaces';

const GEOMETRY: HealthMetricsWorldGeometry = { source: 'test', width: 960, height: 470, countries: [{ code: 'US', name: 'United States', d: 'M0,0Z' }] };

describe('WorldGeometryService', () => {
  let service: WorldGeometryService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(WorldGeometryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('fetches the asset once and shares it with every later map', () => {
    const seen: (HealthMetricsWorldGeometry | null)[] = [];

    service.getGeometry().subscribe((geometry) => seen.push(geometry));
    http.expectOne('/assets/health-metrics/world-countries-110m.json').flush(GEOMETRY);
    service.getGeometry().subscribe((geometry) => seen.push(geometry));

    http.expectNone('/assets/health-metrics/world-countries-110m.json');
    expect(seen).toEqual([GEOMETRY, GEOMETRY]);
  });

  it('answers a failure with null and tries again on the next call', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const seen: (HealthMetricsWorldGeometry | null)[] = [];

    service.getGeometry().subscribe((geometry) => seen.push(geometry));
    http.expectOne('/assets/health-metrics/world-countries-110m.json').flush('', { status: 404, statusText: 'Not Found' });
    service.getGeometry().subscribe((geometry) => seen.push(geometry));
    http.expectOne('/assets/health-metrics/world-countries-110m.json').flush(GEOMETRY);

    expect(seen).toEqual([null, GEOMETRY]);
  });
});
