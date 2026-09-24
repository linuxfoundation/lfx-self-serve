// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS, HEALTH_METRICS_ENGAGEMENT_SECTIONS } from '@lfx-one/shared/constants';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { HealthMetricsEngagementComponent } from './health-metrics-engagement.component';

import type {
  HealthMetricsEngagementGroupCounts,
  HealthMetricsEngagementNonMemberCounts,
  HealthMetricsEngagementOrgCounts,
  HealthMetricsEngagementRepPeriodCounts,
  HealthMetricsEngagementSectionKey,
} from '@lfx-one/shared/interfaces';

// Stands in for the real Group attendance section, matched by selector — the real one would drag
// in HttpClient and the analytics read.
@Component({ selector: 'lfx-engagement-group-attendance', template: '' })
class GroupAttendanceStubComponent {
  public readonly countsChange = output<HealthMetricsEngagementGroupCounts | null>();
  public readonly reading = output<void>();
  public readonly settled = output<void>();
}

// Same stand-in for Meeting participation: the shell only reacts to its two outputs.
@Component({ selector: 'lfx-engagement-meeting-participation', template: '' })
class MeetingParticipationStubComponent {
  public readonly sectionPicked = output<HealthMetricsEngagementSectionKey>();
  public readonly reading = output<void>();
  public readonly settled = output<void>();
}

// Same stand-in for Organization participation.
@Component({ selector: 'lfx-engagement-org-participation', template: '' })
class OrgParticipationStubComponent {
  public readonly countsChange = output<HealthMetricsEngagementOrgCounts | null>();
  public readonly reading = output<void>();
  public readonly settled = output<void>();
}

// Same stand-in for Representatives.
@Component({ selector: 'lfx-engagement-representatives', template: '' })
class RepresentativesStubComponent {
  public readonly countsChange = output<HealthMetricsEngagementRepPeriodCounts | null>();
  public readonly reading = output<void>();
  public readonly settled = output<void>();
}

// Same stand-in for Non-member participation.
@Component({ selector: 'lfx-engagement-non-member-participation', template: '' })
class NonMemberParticipationStubComponent {
  public readonly countsChange = output<HealthMetricsEngagementNonMemberCounts | null>();
  public readonly reading = output<void>();
  public readonly settled = output<void>();
}

// Covers only what Engagement wires into the shell: its copy, badges and section relays. The
// scroll-spy and deep-link behaviour is the shell's own spec.
describe('HealthMetricsEngagementComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsEngagementComponent>;
  let fragment: BehaviorSubject<string | null>;

  function participationChild(): MeetingParticipationStubComponent {
    return fixture.debugElement.query(By.directive(MeetingParticipationStubComponent)).componentInstance as MeetingParticipationStubComponent;
  }

  function orgChild(): OrgParticipationStubComponent {
    return fixture.debugElement.query(By.directive(OrgParticipationStubComponent)).componentInstance as OrgParticipationStubComponent;
  }

  function nonMemberChild(): NonMemberParticipationStubComponent {
    return fixture.debugElement.query(By.directive(NonMemberParticipationStubComponent)).componentInstance as NonMemberParticipationStubComponent;
  }

  function repChild(): RepresentativesStubComponent {
    return fixture.debugElement.query(By.directive(RepresentativesStubComponent)).componentInstance as RepresentativesStubComponent;
  }

  function stubChild(): GroupAttendanceStubComponent {
    return fixture.debugElement.query(By.directive(GroupAttendanceStubComponent)).componentInstance as GroupAttendanceStubComponent;
  }

  /** One settled group read: the badge counts, then the settle the deep link actually waits on. */
  function groupSettles(counts: HealthMetricsEngagementGroupCounts | null = { groups: 34, dormantGroups: 3 }): void {
    stubChild().countsChange.emit(counts);
    stubChild().settled.emit();
  }

  function activeKey(): string | null {
    return fixture.nativeElement.querySelector('[aria-current="true"]')?.getAttribute('data-testid')?.replace('engagement-sub-nav-', '') ?? null;
  }

  beforeEach(async () => {
    // Not implemented in jsdom, and the deep-link path calls it on a real section element.
    Element.prototype.scrollIntoView = vi.fn();
    fragment = new BehaviorSubject<string | null>(null);

    await TestBed.configureTestingModule({
      imports: [HealthMetricsEngagementComponent],
      providers: [HealthMetricsChromeService, { provide: ActivatedRoute, useValue: { fragment: fragment.asObservable() } }],
    })
      .overrideComponent(HealthMetricsEngagementComponent, {
        set: {
          imports: [
            GroupAttendanceStubComponent,
            HealthMetricsL2SectionDirective,
            HealthMetricsL2ShellComponent,
            MeetingParticipationStubComponent,
            NonMemberParticipationStubComponent,
            OrgParticipationStubComponent,
            RepresentativesStubComponent,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HealthMetricsEngagementComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('renders every section with a stable anchor id and its design copy', () => {
    for (const section of HEALTH_METRICS_ENGAGEMENT_SECTIONS) {
      const element = fixture.nativeElement.querySelector(`[data-testid="engagement-section-${section.key}"]`);

      expect(element).not.toBeNull();
      expect(element.getAttribute('id')).toBe(`sec-eng-${section.key}`);
      expect(element.textContent).toContain(section.heading);
    }
  });

  it('marks the caution footnote on the non-member section only', () => {
    const cautioned = HEALTH_METRICS_ENGAGEMENT_SECTIONS.filter((section) => section.footnoteCaution).map((section) => section.key);

    expect(cautioned).toEqual(['nonmem']);
    expect(fixture.nativeElement.querySelectorAll('.fa-triangle-exclamation')).toHaveLength(1);
  });

  it('starts with the first section active and no unresolved count badged', () => {
    expect(activeKey()).toBe(HEALTH_METRICS_ENGAGEMENT_SECTIONS[0].key);
    // Only Group attendance reports in PR 1, and it has not emitted yet, so no rail count is shown.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav"]').textContent).not.toMatch(/\d/);
  });

  it('badges Group attendance from the counts that section reports', () => {
    const child = fixture.debugElement.query(By.directive(GroupAttendanceStubComponent)).componentInstance as GroupAttendanceStubComponent;

    child.countsChange.emit({ groups: 34, dormantGroups: 3 });
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees"]');
    expect(item.textContent).toContain('34');
    expect(item.textContent).toContain('3 dormant');
  });

  it('badges Organization participation from the counts that section reports', () => {
    orgChild().countsChange.emit({ orgs: 136, lapsedOrgs: 54 });
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-orgs"]');
    expect(item.textContent).toContain('136');
    expect(item.textContent).toContain('54 inactive');
  });

  it('badges Representatives from the counts that section reports', () => {
    repChild().countsChange.emit({ range: 'YTD', reps: 486, neverAttendedReps: 112 });
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-reps"]');
    expect(item.textContent).toContain('486');
    expect(item.textContent).toContain('112 never attended');
  });

  it('badges Non-member participation from the counts that section reports', () => {
    nonMemberChild().countsChange.emit({ orgs: 63 });
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-nonmem"]');
    expect(item.textContent).toContain('63');
  });

  it('scrolls to the section a participation cross-link emits, and drops the pending deep link', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    fragment.next('reps');
    scrollIntoView.mockClear();

    participationChild().sectionPicked.emit('committees');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(activeKey()).toBe('committees');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // A key listed with no component emitting `settled` never leaves `unsettledSections`, so every
  // deep link would hang on the TTL. This fails the moment the list grows past its emitters.
  it('has a settle emitter wired for every section the deep link waits on', async () => {
    const emitters: Record<HealthMetricsEngagementSectionKey, (() => void) | undefined> = {
      participation: () => participationChild().settled.emit(),
      committees: () => stubChild().settled.emit(),
      orgs: () => orgChild().settled.emit(),
      reps: () => repChild().settled.emit(),
      nonmem: () => nonMemberChild().settled.emit(),
    } as Record<HealthMetricsEngagementSectionKey, (() => void) | undefined>;
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    fragment.next('reps');
    scrollIntoView.mockClear();

    for (const key of HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS) {
      const emit = emitters[key];
      expect(emit, `no component emits settled for the "${key}" section`).toBeTypeOf('function');
      emit?.();
      fixture.detectChanges();
      await fixture.whenStable();
    }

    // Every listed section settled, so the key is released: a further settle does not re-scroll.
    const settledCalls = scrollIntoView.mock.calls.length;
    participationChild().settled.emit();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(settledCalls);
  });
});
