// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, model, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { MembersMovementsDrawerComponent } from '../members-movements-drawer/members-movements-drawer.component';

import { MembersBridgeComponent } from './members-bridge.component';

import type {
  HealthMetricsMembersBridge,
  HealthMetricsMembersBridgeStep,
  HealthMetricsMembersBridgeStepType,
  HealthMetricsMembersMovementListType,
  HealthMetricsRange,
} from '@lfx-one/shared/interfaces';

/** Records what the bridge hands the drawer; the drawer's own read is its spec's. */
@Component({ selector: 'lfx-members-movements-drawer', template: '' })
class DrawerStubComponent {
  public readonly visible = model<boolean>(false);
  public readonly listType = input<HealthMetricsMembersMovementListType | null>(null);
  public readonly year = input<number | null>(null);
  public readonly foundationSlug = input<string>('');
  public readonly barCount = input<number | null>(null);
}

const ORDER: HealthMetricsMembersBridgeStepType[] = ['start_of_year', 'new', 'upgrade', 'downgrade', 'churned', 'today'];
const SIGN: Record<HealthMetricsMembersBridgeStepType, number> = { start_of_year: 1, new: 1, upgrade: 1, downgrade: -1, churned: -1, today: 1 };

function year(value: number, counts: number[]): HealthMetricsMembersBridgeStep[] {
  return ORDER.map((movementType, index) => ({
    year: value,
    movementType,
    sortOrder: index + 1,
    isPartialYear: value === 2026,
    memberCount: counts[index],
    signedMemberCount: counts[index] * SIGN[movementType],
    revenueImpactUsd: counts[index] * 10_000 * SIGN[movementType],
  }));
}

// 2026 reconciles (41 + 7 + 1 − 3 − 2 = 44); 2025 does not (40 + 3 + 0 − 1 − 1 = 41 ≠ 42).
const BRIDGE: HealthMetricsMembersBridge = { steps: [...year(2026, [41, 7, 1, 3, 2, 44]), ...year(2025, [40, 3, 0, 1, 1, 42])] };

describe('MembersBridgeComponent', () => {
  let fixture: ComponentFixture<MembersBridgeComponent>;
  let getMembersBridge: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let picked: string[];

  async function render(payload: HealthMetricsMembersBridge | Error = BRIDGE): Promise<void> {
    getMembersBridge = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [MembersBridgeComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getMembersBridge } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    })
      .overrideComponent(MembersBridgeComponent, { remove: { imports: [MembersMovementsDrawerComponent] }, add: { imports: [DrawerStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(MembersBridgeComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
    fixture.componentInstance.sectionPicked.subscribe((key) => picked.push(key));
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function drawer(): DrawerStubComponent {
    return fixture.debugElement.query(By.directive(DrawerStubComponent)).componentInstance;
  }

  async function pickRange(range: HealthMetricsRange): Promise<void> {
    TestBed.inject(HealthMetricsChromeService).selectedRange.set(range);
    await settle();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    // Only the clock is faked, so the year the range maps to is pinned without stalling whenStable.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    picked = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the foundation once and settles once the bridge lands', async () => {
    await render();

    expect(getMembersBridge).toHaveBeenCalledTimes(1);
    expect(getMembersBridge).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(query('members-bridge-loading')).toBeNull();
  });

  it('draws the running year with signed counts and dues, and no note when it reconciles', async () => {
    await render();

    expect(text('members-bridge-heading')).toBe('How the base changed this year');
    expect(text('members-bridge-count-new')).toBe('+7');
    expect(text('members-bridge-dues-new')).toBe('+$70K');
    expect(text('members-bridge-count-downgrade')).toBe('−3');
    expect(query('members-bridge-count-downgrade')?.className).toContain('text-red-600');
    expect(query('members-bridge-fill-new')?.className).toContain('bg-emerald-600');
    expect(query('members-bridge-fill-today')?.className).toContain('bg-gray-700');
    expect(text('members-bridge-label-today')).toContain('Today');
    expect(query('members-bridge-reconcile-note')).toBeNull();
    expect(text('members-bridge-footer')).toContain("PCC's total-members all-time line");
  });

  it('shows the recorded figures and a note for a completed year that does not reconcile', async () => {
    await render();

    await pickRange('COMPLETED_YEAR');

    expect(getMembersBridge).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['reading', 'settled', 'settled']);
    expect(text('members-bridge-heading')).toBe('How the base changed in 2025');
    expect(text('members-bridge-label-today')).toContain('End of 2025');
    expect(text('members-bridge-count-today')).toBe('42');
    expect(text('members-bridge-reconcile-note')).toContain('comes to 41, but 42 are recorded at the end of 2025');
  });

  it('opens the drawer with the bar it was picked from', async () => {
    await render();

    query('members-bridge-action-downgrade')?.click();
    await settle();

    expect(drawer().visible()).toBe(true);
    expect(drawer().listType()).toBe('downgrade');
    expect(drawer().year()).toBe(2026);
    expect(drawer().foundationSlug()).toBe('acme');
    expect(drawer().barCount()).toBe(3);
  });

  it('sends the churn bar to its section and leaves an empty movement inert', async () => {
    await render();

    query('members-bridge-action-churned')?.click();
    await settle();

    expect(picked).toEqual(['churn']);
    expect(drawer().visible()).toBe(false);

    await pickRange('COMPLETED_YEAR');
    expect(query('members-bridge-action-upgrade')).toBeNull();
    expect(query('members-bridge-label-upgrade')).not.toBeNull();
  });

  it('says the period has no bridge while other years have one', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_3');

    expect(query('members-bridge-chart')).toBeNull();
    expect(query('members-bridge-year-unmeasured')).not.toBeNull();
  });

  it('shows the empty state for a foundation with no bridge rows', async () => {
    await render({ steps: [] });

    expect(query('members-bridge-empty')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('shows the error state and still settles when the read fails', async () => {
    await render(new Error('boom'));

    expect(query('members-bridge-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);

    await pickRange('COMPLETED_YEAR');
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the skeleton and never settles until a foundation resolves', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersBridge).not.toHaveBeenCalled();
    expect(query('members-bridge-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);

    selectedFoundation.set({ slug: 'acme' });
    await settle();

    expect(getMembersBridge).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
  });
});
