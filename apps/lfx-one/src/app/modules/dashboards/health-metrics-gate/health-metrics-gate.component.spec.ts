// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureFlagService } from '@services/feature-flag.service';
import { describe, expect, it } from 'vitest';

import { HealthMetricsGateComponent } from './health-metrics-gate.component';

// Stand-ins for the real legacy/overview pages, matched by selector — keeps this spec from
// dragging in either page's full dependency tree; only the @if branching under test matters here.
@Component({ selector: 'lfx-health-metrics', template: '<div data-testid="legacy-stub"></div>' })
class LegacyStubComponent {}

@Component({ selector: 'lfx-health-metrics-overview', template: '<div data-testid="overview-stub"></div>' })
class OverviewStubComponent {}

describe('HealthMetricsGateComponent', () => {
  let fixture: ComponentFixture<HealthMetricsGateComponent>;

  async function render(overviewEnabled: WritableSignal<boolean>): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsGateComponent],
      providers: [{ provide: FeatureFlagService, useValue: { getBooleanFlag: () => overviewEnabled } }],
    })
      .overrideComponent(HealthMetricsGateComponent, { set: { imports: [LegacyStubComponent, OverviewStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(HealthMetricsGateComponent);
    fixture.detectChanges();
  }

  it('renders the legacy page when the flag is off', async () => {
    await render(signal(false));

    expect(fixture.nativeElement.querySelector('[data-testid="legacy-stub"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="overview-stub"]')).toBeNull();
  });

  it('renders the overview page when the flag is on', async () => {
    await render(signal(true));

    expect(fixture.nativeElement.querySelector('[data-testid="overview-stub"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="legacy-stub"]')).toBeNull();
  });

  it('swaps pages reactively when the flag signal changes after render', async () => {
    const overviewEnabled = signal(false);
    await render(overviewEnabled);

    overviewEnabled.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="overview-stub"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="legacy-stub"]')).toBeNull();
  });
});
