// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementMeetingParticipationComponent } from './engagement-meeting-participation.component';

import type { HealthMetricsEngagementMeetingParticipation, HealthMetricsEngagementParticipationRow } from '@lfx-one/shared/interfaces';

function participationRow(overrides: Partial<HealthMetricsEngagementParticipationRow> = {}): HealthMetricsEngagementParticipationRow {
  return {
    level: 'all',
    group: null,
    label: 'All meetings',
    totalGroups: 8,
    governance: false,
    periods: [
      {
        range: 'COMPLETED_YEAR_3',
        meetingsHeld: 14,
        invitedCount: 140,
        attendedCount: 77,
        attendancePct: 0.55,
        activeGroups: 5,
        neverAttended: 4,
        attendanceChangePp: null,
        meetingsChangePct: null,
      },
      {
        range: 'COMPLETED_YEAR_2',
        meetingsHeld: 16,
        invitedCount: 160,
        attendedCount: 96,
        attendancePct: 0.6,
        activeGroups: 6,
        neverAttended: 4,
        attendanceChangePp: 0.05,
        meetingsChangePct: 0.142857,
      },
      {
        range: 'COMPLETED_YEAR',
        meetingsHeld: 20,
        invitedCount: 200,
        attendedCount: 130,
        attendancePct: 0.65,
        activeGroups: 7,
        neverAttended: 2,
        attendanceChangePp: 0.05,
        meetingsChangePct: 0.25,
      },
      {
        range: 'YTD',
        meetingsHeld: 12,
        invitedCount: 120,
        attendedCount: 84,
        attendancePct: 0.7,
        activeGroups: 6,
        neverAttended: 3,
        attendanceChangePp: 0.04,
        meetingsChangePct: 0.2,
      },
    ],
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsEngagementMeetingParticipation> = {}): HealthMetricsEngagementMeetingParticipation {
  return {
    total: participationRow(),
    rows: [
      participationRow({ level: 'group', group: 'Board', label: 'Board', governance: true }),
      participationRow({ level: 'group', group: 'Marketing', label: 'Marketing' }),
    ],
    ...overrides,
  };
}

describe('EngagementMeetingParticipationComponent', () => {
  let fixture: ComponentFixture<EngagementMeetingParticipationComponent>;
  let getEngagementMeetingParticipation: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;

  function text(testId: string): string {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function render(
    payload: HealthMetricsEngagementMeetingParticipation = response(),
    queryParams: Record<string, string> = {},
    onSection?: (key: unknown) => void,
    lifecycle?: string[]
  ): Promise<void> {
    getEngagementMeetingParticipation = vi.fn().mockReturnValue(of(payload));

    await TestBed.configureTestingModule({
      imports: [EngagementMeetingParticipationComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getEngagementMeetingParticipation } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        // The mode pill reads its initial value off the URL, and writes it back.
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementMeetingParticipationComponent);
    if (onSection) fixture.componentInstance.sectionPicked.subscribe(onSection);
    // Subscribed before the first change detection, so the initial read's own pair is recorded.
    if (lifecycle) {
      fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
      fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
  });

  it('reads the selected foundation and period, and renders the roll-up the view computed', async () => {
    await render();

    expect(getEngagementMeetingParticipation).toHaveBeenCalledWith({ foundationSlug: 'acme', projectSlug: null, range: 'YTD' });
    expect(text('engagement-meeting-participation-hero')).toContain('70%');
    expect(text('engagement-meeting-participation-hero')).toContain('All-meeting attendance');
    expect(text('engagement-meeting-participation-delta')).toBe('+4.0pp vs prior period');
    expect(text('engagement-meeting-participation-count')).toBe('12 meetings in period');
    expect(text('engagement-meeting-participation-secondary')).toBe('12');
  });

  // The hero must read the view's own `all` row: summing the type rows double-counts a meeting
  // that belongs to more than one group.
  it('takes the hero from the roll-up row rather than the type rows', async () => {
    await render();

    expect(text('engagement-meeting-participation-active-groups-value')).toBe('6 / 8');
    expect(text('engagement-meeting-participation-never-attended-value')).toBe('3');
  });

  it('lays the hero out as the design does: delta inline, side stats as columns, never attended in red', async () => {
    await render();

    const hero = fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-hero"]');
    expect(hero.querySelector('[data-testid="engagement-meeting-participation-delta"] .sr-only').textContent).toBe(' vs prior period');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-side"]').classList).toContain('flex-wrap');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-active-groups"]').textContent).toContain('Active groups');
    // Labels use gray-500, a shade darker than the design's gray-400, so the 11.5px text clears WCAG AA contrast.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-active-groups"] span').classList).toContain('text-gray-500');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-never-attended-value"]').classList).toContain('text-red-600');
  });

  it('keeps Never attended in ink when nobody has missed every meeting', async () => {
    const total = participationRow();
    total.periods = total.periods.map((period) => ({ ...period, neverAttended: 0 }));
    await render(response({ total }));

    const value = fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-never-attended-value"]');
    expect(value.classList).toContain('text-gray-900');
    expect(value.classList).not.toContain('text-red-600');
  });

  it('swaps the hero and the side row in meetings mode', async () => {
    await render();

    fixture.componentInstance['onModeChange']('meetings');
    fixture.detectChanges();

    expect(text('engagement-meeting-participation-hero')).toContain('Meetings held');
    expect(text('engagement-meeting-participation-hero')).toContain('12');
    // The design shows no delta for meetings held.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-delta"]')).toBeNull();
    expect(text('engagement-meeting-participation-secondary')).toBe('70%');
  });

  // The design's meetings mode keeps three columns: a blank middle one, and the count drawn as a bar.
  it('keeps three columns in meetings mode, with a count bar scaled to the busiest type row', async () => {
    const base = participationRow();
    const withYtdMeetings = (meetingsHeld: number) => base.periods.map((period) => (period.range === 'YTD' ? { ...period, meetingsHeld } : period));
    await render(
      response({
        // The roll-up's own count is larger than any type row, and must not set the scale.
        total: participationRow({ periods: withYtdMeetings(40) }),
        rows: [
          participationRow({ level: 'group', group: 'Board', label: 'Board', governance: true, periods: withYtdMeetings(6) }),
          participationRow({ level: 'group', group: 'Marketing', label: 'Marketing', periods: withYtdMeetings(24) }),
        ],
      })
    );

    fixture.componentInstance['onModeChange']('meetings');
    fixture.detectChanges();

    const headers = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="engagement-meeting-participation-table"] th')) as HTMLElement[];
    expect(headers.map((th) => th.textContent?.trim())).toEqual(['Meeting type', '', 'Meetings held']);

    const board = fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-row-Board"]') as HTMLElement;
    const cells = Array.from(board.querySelectorAll('td')) as HTMLElement[];
    expect(cells).toHaveLength(3);
    expect(cells[1].textContent?.trim()).toBe('');
    expect(cells[2].querySelector('[data-testid="engagement-attendance-bar-label"]')?.textContent?.trim()).toBe('6');
    const boardFill = cells[2].querySelector('[data-testid="engagement-attendance-bar-track"] > div') as HTMLElement;
    expect(boardFill.style.width).toBe('25%');
    expect(boardFill.className).toContain('bg-blue-500');

    const marketing = fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-row-Marketing"]') as HTMLElement;
    expect((marketing.querySelector('[data-testid="engagement-attendance-bar-track"] > div') as HTMLElement).style.width).toBe('100%');
  });

  it('keeps the meetings count and attendance bar columns in attendance mode', async () => {
    await render();

    const headers = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="engagement-meeting-participation-table"] th')) as HTMLElement[];
    expect(headers.map((th) => th.textContent?.trim())).toEqual(['Meeting type', 'Meetings', 'Attendance']);
    const board = fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-row-Board"]') as HTMLElement;
    expect(board.querySelectorAll('td')[1].textContent?.trim()).toBe('12');
    expect(board.querySelector('[data-testid="engagement-attendance-bar-label"]')?.textContent?.trim()).toBe('70%');
  });

  // A board must sit near full attendance, so 70% is red there while it is fine for any other type.
  it('holds the Board row to the board rule and every other type to the general one', async () => {
    await render();

    const fill = (label: string): HTMLElement =>
      fixture.nativeElement.querySelector(
        `[data-testid="engagement-meeting-participation-row-${label}"] [data-testid="engagement-attendance-bar-track"] > div`
      ) as HTMLElement;
    expect(fill('Board').classList).toContain('bg-red-500');
    expect(fill('Marketing').classList).toContain('bg-blue-500');
  });

  // The server can emit a present roll-up row whose cells are all unmeasured; none may read as zero.
  it('renders every cell of an unmeasured roll-up as an em dash, in both modes', async () => {
    const base = participationRow();
    const total = participationRow({
      totalGroups: null,
      periods: base.periods.map((period) => ({
        ...period,
        meetingsHeld: null,
        attendancePct: null,
        activeGroups: null,
        neverAttended: null,
        attendanceChangePp: null,
        meetingsChangePct: null,
      })),
    });
    await render(response({ total }));

    expect(text('engagement-meeting-participation-count')).toBe('Meetings in period not available yet');
    expect(text('engagement-meeting-participation-hero')).toContain('—');
    expect(text('engagement-meeting-participation-secondary')).toBe('—');
    expect(text('engagement-meeting-participation-delta')).toBe('— vs prior period');
    expect(text('engagement-meeting-participation-active-groups-value')).toBe('—');
    expect(text('engagement-meeting-participation-never-attended-value')).toBe('—');

    fixture.componentInstance['onModeChange']('meetings');
    fixture.detectChanges();

    expect(text('engagement-meeting-participation-hero')).toContain('—');
    expect(text('engagement-meeting-participation-secondary')).toBe('—');
  });

  it('renders one row per meeting type, flagging the governance cut as Members detail', async () => {
    await render();

    const board = fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-row-Board"]');
    expect(board.textContent).toContain('governance');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-row-Marketing"]').textContent).not.toContain('governance');
  });

  it("re-reads the selected project, since the roll-up is the view's own row for that scope", async () => {
    await render();
    getEngagementMeetingParticipation.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedProjectSlug.set('acme-core');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getEngagementMeetingParticipation).toHaveBeenCalledWith({ foundationSlug: 'acme', projectSlug: 'acme-core', range: 'YTD' });
  });

  it('re-reads when the period changes, since the response carries every period per row', async () => {
    await render();
    getEngagementMeetingParticipation.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getEngagementMeetingParticipation).toHaveBeenCalledWith({ foundationSlug: 'acme', projectSlug: null, range: 'COMPLETED_YEAR' });
    expect(text('engagement-meeting-participation-hero')).toContain('65%');
  });

  // Under three meetings the rate is not reportable, and the banner has to say so next to it.
  it('warns when the period holds too few meetings to rate', async () => {
    const thin = participationRow();
    thin.periods[3] = { ...thin.periods[3], meetingsHeld: 2 };
    await render(response({ total: thin, rows: [] }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-low-confidence"]')).not.toBeNull();
    expect(text('engagement-meeting-participation-hero')).toContain('No data');
  });

  it('cross-links the hero counts, landing Never attended on its filter', async () => {
    const picked: unknown[] = [];
    await render(response(), {}, (key) => picked.push(key));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-active-groups"]').click();
    fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-never-attended"]').click();

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { repFilter: 'never' }, queryParamsHandling: 'merge', preserveFragment: true, replaceUrl: true })
    );
    await vi.waitFor(() => expect(picked).toEqual(['committees', 'reps']));
  });

  it('links the governance name to Members board attendance, clearing a cohort the URL carries', async () => {
    await render();

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-row-Board-link"]');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/foundation/health-metrics/members#board');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-row-Board"]').getAttribute('tabindex')).toBeNull();
    // Plain row text, not a blue underlined link: the row itself carries the click affordance.
    expect(link.classList).toContain('!text-gray-900');
    expect(link.classList).toContain('!no-underline');
  });

  it('opens Members board attendance from anywhere on the governance row', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-row-Board"]').click();

    expect(navigate).toHaveBeenCalledWith(['/foundation/health-metrics', 'members'], {
      fragment: 'board',
      queryParams: { boardCohort: null, boardPage: null },
      queryParamsHandling: 'merge',
    });
  });

  it('scrolls any other meeting type to Group attendance, once per click on the row or its name button', async () => {
    const picked: unknown[] = [];
    await render(response(), {}, (key) => picked.push(key));

    fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-row-Marketing"]').click();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-row-Marketing-link"]');
    expect(button.tagName).toBe('BUTTON');
    expect(button.className).not.toContain('underline');
    button.click();

    expect(picked).toEqual(['committees', 'committees']);
  });

  // The container holds a deep link until every section settles and re-holds it on the next
  // `reading`, so both halves have to fire — and pair up — for each read.
  it('brackets every read with reading then settled, so the container can re-anchor above it', async () => {
    const lifecycle: string[] = [];
    await render(response(), {}, undefined, lifecycle);

    expect(lifecycle).toEqual(['reading', 'settled']);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(lifecycle).toEqual(['reading', 'settled', 'reading', 'settled']);
  });

  // A failed read must not render the copy that asserts the foundation has never met.
  it('separates a failed read from an empty one', async () => {
    await render();
    getEngagementMeetingParticipation.mockReturnValue(throwError(() => new Error('gateway timeout')));

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-empty"]')).toBeNull();
    expect(text('engagement-meeting-participation-count')).toBe('—');
  });

  it('renders the empty state for a foundation the view has no roll-up row for', async () => {
    await render(response({ total: null, rows: [] }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-empty"]')).not.toBeNull();
  });

  // An unresolved foundation is not a foundation with no meetings, and the two must not look alike.
  it('holds the skeleton while no foundation is selected, rather than captioning an unread scope', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEngagementMeetingParticipation).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-loading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-empty"]')).toBeNull();
  });

  // The URL is the only carrier of the mode across a reload or a shared link.
  it('starts in the mode the URL carries', async () => {
    await render(response(), { partMode: 'meetings' });

    expect(text('engagement-meeting-participation-hero')).toContain('Meetings held');
  });

  it('falls back to attendance for a mode it cannot honour', async () => {
    await render(response(), { partMode: 'sideways' });

    expect(text('engagement-meeting-participation-hero')).toContain('All-meeting attendance');
  });

  it('writes the mode back to the URL, dropping it at its default', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance['onModeChange']('meetings');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { partMode: 'meetings' }, preserveFragment: true, replaceUrl: true }));

    fixture.componentInstance['onModeChange']('attendance');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { partMode: null } }));
  });
});
