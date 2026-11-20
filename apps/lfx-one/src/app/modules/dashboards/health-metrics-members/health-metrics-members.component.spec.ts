// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, model, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { HEALTH_METRICS_MEMBERS_SECTIONS } from '@lfx-one/shared/constants';
import { UserService } from '@services/user.service';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { MembersAtRiskComponent } from './components/members-at-risk/members-at-risk.component';
import { MembersBoardAttendanceComponent } from './components/members-board-attendance/members-board-attendance.component';
import { MembersBreakdownComponent } from './components/members-breakdown/members-breakdown.component';
import { MembersChurnComponent } from './components/members-churn/members-churn.component';
import { MembersDirectoryComponent } from './components/members-directory/members-directory.component';
import { MembersGrowthComponent } from './components/members-growth/members-growth.component';
import { MembersNpsComponent } from './components/members-nps/members-nps.component';
import { MembersRenewalsComponent } from './components/members-renewals/members-renewals.component';
import { HealthMetricsMembersComponent } from './health-metrics-members.component';

import type { HealthMetricsMembersAtRiskFilter, HealthMetricsMembersBoardCohort, HealthMetricsMembersRenewalsWindow } from '@lfx-one/shared/interfaces';

/** Stands in for Member growth by year, whose read its own spec covers; the test drives its settle. */
@Component({ selector: 'lfx-members-growth', template: '<div data-testid="members-growth-stub"></div>' })
class GrowthStubComponent {
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for Membership breakdown by tier, whose read its own spec covers; the test drives its outputs. */
@Component({ selector: 'lfx-members-breakdown', template: '<div data-testid="members-breakdown-stub"></div>' })
class BreakdownStubComponent {
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for the members directory; the test drives its settle. */
@Component({ selector: 'lfx-members-directory', template: '<div data-testid="members-directory-stub"></div>' })
class DirectoryStubComponent {
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for the at-risk section; the test drives its note and settle. */
@Component({ selector: 'lfx-members-at-risk', template: '<div data-testid="members-at-risk-stub"></div>' })
class AtRiskStubComponent {
  public readonly bucket = model<HealthMetricsMembersAtRiskFilter>('all');
  public readonly noteChange = output<string>();
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for the member satisfaction section; the test drives its settle. */
@Component({ selector: 'lfx-members-nps', template: '<div data-testid="members-nps-stub"></div>' })
class NpsStubComponent {
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for the churn section; the test drives its settle. */
@Component({ selector: 'lfx-members-churn', template: '<div data-testid="members-churn-stub"></div>' })
class ChurnStubComponent {
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for the renewals section; the test drives its settle. */
@Component({ selector: 'lfx-members-renewals', template: '<div data-testid="members-renewals-stub"></div>' })
class RenewalsStubComponent {
  public readonly window = model<HealthMetricsMembersRenewalsWindow>('90_days');
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for the board attendance section; the test drives its note and settle. */
@Component({ selector: 'lfx-members-board-attendance', template: '<div data-testid="members-board-stub"></div>' })
class BoardStubComponent {
  public readonly cohort = model<HealthMetricsMembersBoardCohort>('board');
  public readonly noteChange = output<string>();
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

// Covers only what Members wires into the shell: its copy, section bodies and sub-nav. The scroll-spy
// and deep-link behaviour is the shell's own spec.
describe('HealthMetricsMembersComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsMembersComponent>;

  async function setup(initialFragment: string | null = null, queryParams: Record<string, string> = {}): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsMembersComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        {
          provide: ActivatedRoute,
          useValue: {
            fragment: new BehaviorSubject<string | null>(initialFragment).asObservable(),
            snapshot: { queryParamMap: convertToParamMap(queryParams) },
          },
        },
      ],
    })
      .overrideComponent(HealthMetricsMembersComponent, {
        remove: {
          imports: [
            MembersAtRiskComponent,
            MembersBoardAttendanceComponent,
            MembersBreakdownComponent,
            MembersChurnComponent,
            MembersDirectoryComponent,
            MembersGrowthComponent,
            MembersNpsComponent,
            MembersRenewalsComponent,
          ],
        },
        add: {
          imports: [
            AtRiskStubComponent,
            BoardStubComponent,
            BreakdownStubComponent,
            ChurnStubComponent,
            DirectoryStubComponent,
            GrowthStubComponent,
            NpsStubComponent,
            RenewalsStubComponent,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HealthMetricsMembersComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    // Not implemented in jsdom, and the deep-link path calls it on a real section element.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('renders the eight sections in order, each anchored with its design copy and a body or placeholder', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="members-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => `sec-mem-${section.key}`));
    rendered.forEach((element, index) => {
      const key = HEALTH_METRICS_MEMBERS_SECTIONS[index].key;
      expect(element.textContent).toContain(HEALTH_METRICS_MEMBERS_SECTIONS[index].heading);
      if (key === 'growth') {
        expect(element.querySelector('[data-testid="members-growth-stub"]')).not.toBeNull();
        expect(element.textContent).not.toContain('Awaiting data');
      } else if (key === 'breakdown') {
        expect(element.querySelector('[data-testid="members-breakdown-stub"]')).not.toBeNull();
        expect(element.textContent).not.toContain('Awaiting data');
      } else if (key === 'list') {
        expect(element.querySelector('[data-testid="members-directory-stub"]')).not.toBeNull();
        expect(element.textContent).not.toContain('Awaiting data');
      } else if (key === 'risk') {
        expect(element.querySelector('[data-testid="members-at-risk-stub"]')).not.toBeNull();
        expect(element.textContent).not.toContain('Awaiting data');
      } else if (key === 'renewals') {
        expect(element.querySelector('[data-testid="members-renewals-stub"]')).not.toBeNull();
        expect(element.textContent).not.toContain('Awaiting data');
      } else if (key === 'board') {
        expect(element.querySelector('[data-testid="members-board-stub"]')).not.toBeNull();
        expect(element.textContent).not.toContain('Awaiting data');
      } else if (key === 'nps') {
        expect(element.querySelector('[data-testid="members-nps-stub"]')).not.toBeNull();
        expect(element.textContent).not.toContain('Awaiting data');
      } else {
        expect(key).toBe('churn');
        expect(element.querySelector('[data-testid="members-churn-stub"]')).not.toBeNull();
        expect(element.textContent).not.toContain('Awaiting data');
      }
    });
  });

  it('lists every section in the sub-nav, with no note before a read', async () => {
    await setup();
    const nav = fixture.nativeElement.querySelector('[data-testid="members-sub-nav"]');

    for (const section of HEALTH_METRICS_MEMBERS_SECTIONS) {
      expect(fixture.nativeElement.querySelector(`[data-testid="members-sub-nav-${section.key}"]`).textContent).toContain(section.label);
    }
    expect(nav.querySelector('[role="tooltip"]')).toBeNull();
  });

  function stub<T>(type: new (...args: never[]) => T): T {
    return fixture.debugElement.query(By.directive(type)).componentInstance as T;
  }

  async function flush(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('holds a deep link until the growth, breakdown, directory, at-risk, renewals, board, nps and churn reads settle', async () => {
    await setup('churn');
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    // Each settle re-lands the held link; it is released only once every data section has settled.
    stub(GrowthStubComponent).settled.emit(false);
    await flush();
    stub(BreakdownStubComponent).settled.emit(false);
    await flush();
    scrollIntoView.mockClear();
    stub(BreakdownStubComponent).settled.emit(false);
    await flush();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    stub(DirectoryStubComponent).settled.emit(false);
    await flush();
    scrollIntoView.mockClear();
    stub(BreakdownStubComponent).settled.emit(false);
    await flush();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    stub(AtRiskStubComponent).settled.emit(false);
    await flush();
    scrollIntoView.mockClear();
    stub(BreakdownStubComponent).settled.emit(false);
    await flush();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    stub(RenewalsStubComponent).settled.emit(false);
    await flush();
    scrollIntoView.mockClear();
    stub(BreakdownStubComponent).settled.emit(false);
    await flush();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    stub(BoardStubComponent).settled.emit(false);
    await flush();
    scrollIntoView.mockClear();
    stub(BreakdownStubComponent).settled.emit(false);
    await flush();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    stub(NpsStubComponent).settled.emit(false);
    await flush();
    scrollIntoView.mockClear();
    stub(BreakdownStubComponent).settled.emit(false);
    await flush();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    stub(ChurnStubComponent).settled.emit(false);
    await flush();
    scrollIntoView.mockClear();
    stub(BreakdownStubComponent).settled.emit(false);
    await flush();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('members-sub-nav-churn');
  });

  it('notes At-risk & balance with the at-risk summary once it reports one', async () => {
    await setup();
    const item = () => fixture.nativeElement.querySelector('[data-testid="members-sub-nav-risk"]').textContent;

    stub(AtRiskStubComponent).noteChange.emit('12 overdue · $480K');
    await flush();
    expect(item()).toContain('12 overdue · $480K');

    stub(AtRiskStubComponent).noteChange.emit('');
    await flush();
    expect(item()).not.toContain('overdue');
  });

  it("puts the at-risk bucket switch in that card's header, seeded from the URL and handed to the section", async () => {
    await setup(null, { riskBucket: '90_plus_days' });
    const section = fixture.nativeElement.querySelector('#sec-mem-risk') as HTMLElement;

    const labels = [...section.querySelectorAll('[data-testid="members-at-risk-bucket"] [data-testid="ui-switch-option-text"]')].map((label) =>
      label.textContent?.trim()
    );
    expect(labels).toEqual(['All at risk', '60–89 days', '90+ days']);
    expect(stub(AtRiskStubComponent).bucket()).toBe('90_plus_days');

    (section.querySelector('[data-testid="members-at-risk-bucket-60_89_days"] input') as HTMLInputElement).click();
    await flush();
    expect(stub(AtRiskStubComponent).bucket()).toBe('60_89_days');
  });

  it("puts the renewals window switch in that card's header, seeded from the URL and handed to the section", async () => {
    await setup(null, { renewalsWindow: 'this_year' });
    const section = fixture.nativeElement.querySelector('#sec-mem-renewals') as HTMLElement;

    const labels = [...section.querySelectorAll('[data-testid="members-renewals-window"] [data-testid="ui-switch-option-text"]')].map((label) =>
      label.textContent?.trim()
    );
    expect(labels).toEqual(['Next 90 days', 'Next 180 days', 'This year']);
    expect(stub(RenewalsStubComponent).window()).toBe('this_year');

    (section.querySelector('[data-testid="members-renewals-window-180_days"] input') as HTMLInputElement).click();
    await flush();
    expect(stub(RenewalsStubComponent).window()).toBe('180_days');
  });

  it("puts the board cohort switch in that card's header, seeded from the URL and handed to the section", async () => {
    await setup(null, { boardCohort: 'voting_members' });
    const section = fixture.nativeElement.querySelector('#sec-mem-board') as HTMLElement;

    const labels = [...section.querySelectorAll('[data-testid="members-board-cohort"] [data-testid="ui-switch-option-text"]')].map((label) =>
      label.textContent?.trim()
    );
    expect(labels).toEqual(['Board', 'Voting members']);
    expect(stub(BoardStubComponent).cohort()).toBe('voting_members');

    (section.querySelector('[data-testid="members-board-cohort-board"] input') as HTMLInputElement).click();
    await flush();
    expect(stub(BoardStubComponent).cohort()).toBe('board');
  });

  it('falls back to the default bucket, window and cohort for URL values it does not know', async () => {
    await setup(null, { riskBucket: 'under_60_days', renewalsWindow: '30_days', boardCohort: 'committee' });

    expect(stub(AtRiskStubComponent).bucket()).toBe('all');
    expect(stub(RenewalsStubComponent).window()).toBe('90_days');
    expect(stub(BoardStubComponent).cohort()).toBe('board');
  });

  it('notes Board & voting attendance with the board note once it reports one', async () => {
    await setup();
    const item = () => fixture.nativeElement.querySelector('[data-testid="members-sub-nav-board"]').textContent;

    stub(BoardStubComponent).noteChange.emit('3 seats unused');
    await flush();
    expect(item()).toContain('3 seats unused');

    stub(BoardStubComponent).noteChange.emit('');
    await flush();
    expect(item()).not.toContain('unused');
  });
});
