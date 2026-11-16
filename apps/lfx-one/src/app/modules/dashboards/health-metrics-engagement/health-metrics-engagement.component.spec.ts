// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output, OutputEmitterRef, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS, HEALTH_METRICS_ENGAGEMENT_SECTIONS } from '@lfx-one/shared/constants';
import { UserService } from '@services/user.service';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { HealthMetricsEngagementComponent } from './health-metrics-engagement.component';

import type {
  HealthMetricsEngagementGroupNoteCounts,
  HealthMetricsEngagementOrgNoteCounts,
  HealthMetricsEngagementRepNoteCounts,
  HealthMetricsEngagementSectionKey,
} from '@lfx-one/shared/interfaces';

// Stands in for the real Group attendance section, matched by selector — the real one would drag
// in HttpClient and the analytics read.
@Component({ selector: 'lfx-engagement-group-attendance', template: '' })
class GroupAttendanceStubComponent {
  public readonly countsChange = output<HealthMetricsEngagementGroupNoteCounts | null>();
  public readonly reading = output<void>();
  public readonly settled = output<boolean | null>();
}

// Same stand-in for Meeting participation: the shell only reacts to its two outputs.
@Component({ selector: 'lfx-engagement-meeting-participation', template: '' })
class MeetingParticipationStubComponent {
  public readonly sectionPicked = output<HealthMetricsEngagementSectionKey>();
  public readonly reading = output<void>();
  public readonly settled = output<boolean | null>();
}

// Same stand-in for Attendance trend: it reports its reads and nothing else.
@Component({ selector: 'lfx-engagement-attendance-trend', template: '' })
class AttendanceTrendStubComponent {
  public readonly reading = output<void>();
  public readonly settled = output<boolean | null>();
}

// Same stand-in for Organization participation.
@Component({ selector: 'lfx-engagement-org-participation', template: '' })
class OrgParticipationStubComponent {
  public readonly countsChange = output<HealthMetricsEngagementOrgNoteCounts | null>();
  public readonly reading = output<void>();
  public readonly settled = output<boolean | null>();
}

// Same stand-in for Representatives.
@Component({ selector: 'lfx-engagement-representatives', template: '' })
class RepresentativesStubComponent {
  public readonly countsChange = output<HealthMetricsEngagementRepNoteCounts | null>();
  public readonly reading = output<void>();
  public readonly settled = output<boolean | null>();
}

// Same stand-in for Non-member participation.
@Component({ selector: 'lfx-engagement-non-member-participation', template: '' })
class NonMemberParticipationStubComponent {
  public readonly reading = output<void>();
  public readonly settled = output<boolean | null>();
}

// Same stand-in for Newsletter performance.
@Component({ selector: 'lfx-engagement-newsletter-performance', template: '' })
class NewsletterPerformanceStubComponent {
  public readonly reading = output<void>();
  public readonly settled = output<boolean | null>();
}

// Same stand-in for Newsletter recipient engagement.
@Component({ selector: 'lfx-engagement-newsletter-recipients', template: '' })
class NewsletterRecipientsStubComponent {
  public readonly reading = output<void>();
  public readonly settled = output<boolean | null>();
}

// Covers only what Engagement wires into the shell: its copy, notes and section relays. The
// scroll-spy and deep-link behaviour is the shell's own spec.
describe('HealthMetricsEngagementComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsEngagementComponent>;
  let fragment: BehaviorSubject<string | null>;

  function participationChild(): MeetingParticipationStubComponent {
    return fixture.debugElement.query(By.directive(MeetingParticipationStubComponent)).componentInstance as MeetingParticipationStubComponent;
  }

  function trendChild(): AttendanceTrendStubComponent {
    return fixture.debugElement.query(By.directive(AttendanceTrendStubComponent)).componentInstance as AttendanceTrendStubComponent;
  }

  function orgChild(): OrgParticipationStubComponent {
    return fixture.debugElement.query(By.directive(OrgParticipationStubComponent)).componentInstance as OrgParticipationStubComponent;
  }

  function nonMemberChild(): NonMemberParticipationStubComponent {
    return fixture.debugElement.query(By.directive(NonMemberParticipationStubComponent)).componentInstance as NonMemberParticipationStubComponent;
  }

  function newsletterChild(): NewsletterPerformanceStubComponent {
    return fixture.debugElement.query(By.directive(NewsletterPerformanceStubComponent)).componentInstance as NewsletterPerformanceStubComponent;
  }

  function recipientsChild(): NewsletterRecipientsStubComponent {
    return fixture.debugElement.query(By.directive(NewsletterRecipientsStubComponent)).componentInstance as NewsletterRecipientsStubComponent;
  }

  function repChild(): RepresentativesStubComponent {
    return fixture.debugElement.query(By.directive(RepresentativesStubComponent)).componentInstance as RepresentativesStubComponent;
  }

  function stubChild(): GroupAttendanceStubComponent {
    return fixture.debugElement.query(By.directive(GroupAttendanceStubComponent)).componentInstance as GroupAttendanceStubComponent;
  }

  // The body each data section is projected as, for the tests that drive its `reading`/`settled` relays.
  const sectionChildren: Record<
    (typeof HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS)[number],
    () => { reading: OutputEmitterRef<void>; settled: OutputEmitterRef<boolean | null> }
  > = {
    participation: participationChild,
    committees: stubChild,
    trend: trendChild,
    orgs: orgChild,
    reps: repChild,
    nonmem: nonMemberChild,
    newsletters: newsletterChild,
    recipients: recipientsChild,
  };

  /** One settled group read: the note counts, then the settle the deep link actually waits on. */
  function groupSettles(counts: HealthMetricsEngagementGroupNoteCounts | null = { dormantGroups: 3, lowAttendanceGroups: 2 }): void {
    stubChild().countsChange.emit(counts);
    stubChild().settled.emit(false);
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
      providers: [
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { fragment: fragment.asObservable() } },
      ],
    })
      .overrideComponent(HealthMetricsEngagementComponent, {
        set: {
          imports: [
            AttendanceTrendStubComponent,
            GroupAttendanceStubComponent,
            HealthMetricsL2SectionDirective,
            HealthMetricsL2ShellComponent,
            MeetingParticipationStubComponent,
            NewsletterPerformanceStubComponent,
            NewsletterRecipientsStubComponent,
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

  // The design drops every plain footnote; only the non-member caution is left, as a warning note.
  it('carries a note on the non-member section only, as a caution', () => {
    const noted = HEALTH_METRICS_ENGAGEMENT_SECTIONS.filter((section) => 'note' in section).map((section) => [section.key, section.note.tone]);

    expect(noted).toEqual([['nonmem', 'caution']]);
    expect(fixture.nativeElement.querySelectorAll('.fa-triangle-exclamation')).toHaveLength(1);
  });

  it('starts with the first section active and no note before any section reports', () => {
    expect(activeKey()).toBe(HEALTH_METRICS_ENGAGEMENT_SECTIONS[0].key);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav"] [role="tooltip"]')).toBeNull();
  });

  it('notes Group attendance from the counts that section reports', () => {
    const child = fixture.debugElement.query(By.directive(GroupAttendanceStubComponent)).componentInstance as GroupAttendanceStubComponent;

    child.countsChange.emit({ dormantGroups: 3, lowAttendanceGroups: 5 });
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees"]');
    expect(item.textContent).toContain('3 dormant · 5 below 50%');
  });

  it('drops the below-50% part of the Group attendance note at zero', () => {
    const child = fixture.debugElement.query(By.directive(GroupAttendanceStubComponent)).componentInstance as GroupAttendanceStubComponent;

    child.countsChange.emit({ dormantGroups: 3, lowAttendanceGroups: 0 });
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees"]');
    expect(item.textContent).toContain('3 dormant');
    expect(item.textContent).not.toContain('below 50%');
  });

  it('notes Organization participation from the counts that section reports', () => {
    orgChild().countsChange.emit({ lapsedOrgs: 54 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-orgs"]').textContent).toContain('54 inactive');
  });

  it('notes Representatives from the counts that section reports', () => {
    repChild().countsChange.emit({ neverAttendedReps: 112 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-reps"]').textContent).toContain('112 never attended');
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
      participation: () => participationChild().settled.emit(false),
      committees: () => stubChild().settled.emit(false),
      trend: () => trendChild().settled.emit(false),
      orgs: () => orgChild().settled.emit(false),
      reps: () => repChild().settled.emit(false),
      nonmem: () => nonMemberChild().settled.emit(false),
      newsletters: () => newsletterChild().settled.emit(false),
      recipients: () => recipientsChild().settled.emit(false),
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
    participationChild().settled.emit(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(settledCalls);
  });

  // A dropped or misrouted `(reading)` binding would release a late deep link before that re-read lands.
  it.each(HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS)('holds a late deep link while the "%s" section re-reads', async (key) => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    for (const settledKey of HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS) sectionChildren[settledKey]().settled.emit(false);
    fixture.detectChanges();
    await fixture.whenStable();

    sectionChildren[key]().reading.emit();
    fragment.next('committees');
    scrollIntoView.mockClear();

    sectionChildren[key]().settled.emit(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // That read was the only one outstanding, so the key is released: a further settle does not re-scroll.
    sectionChildren[key]().settled.emit(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
