// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
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

/** Stands in for Member growth by year, whose read its own spec covers; the test drives its settle. */
@Component({ selector: 'lfx-members-growth', template: '<div data-testid="members-growth-stub"></div>' })
class GrowthStubComponent {
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for Membership breakdown by tier, whose read its own spec covers; the test drives its outputs. */
@Component({ selector: 'lfx-members-breakdown', template: '<div data-testid="members-breakdown-stub"></div>' })
class BreakdownStubComponent {
  public readonly countChange = output<number | null>();
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for the members directory; the test drives its count and settle. */
@Component({ selector: 'lfx-members-directory', template: '<div data-testid="members-directory-stub"></div>' })
class DirectoryStubComponent {
  public readonly countChange = output<number | null>();
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for the at-risk section; the test drives its note and settle. */
@Component({ selector: 'lfx-members-at-risk', template: '<div data-testid="members-at-risk-stub"></div>' })
class AtRiskStubComponent {
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

/** Stands in for the renewals section; the test drives its count and settle. */
@Component({ selector: 'lfx-members-renewals', template: '<div data-testid="members-renewals-stub"></div>' })
class RenewalsStubComponent {
  public readonly countChange = output<number | null>();
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for the board attendance section; the test drives its note and settle. */
@Component({ selector: 'lfx-members-board-attendance', template: '<div data-testid="members-board-stub"></div>' })
class BoardStubComponent {
  public readonly noteChange = output<string>();
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

// Covers only what Members wires into the shell: its copy, section bodies and sub-nav. The scroll-spy
// and deep-link behaviour is the shell's own spec.
describe('HealthMetricsMembersComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsMembersComponent>;

  async function setup(initialFragment: string | null = null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsMembersComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { fragment: new BehaviorSubject<string | null>(initialFragment).asObservable() } },
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

  it('lists every section in the sub-nav, with no badge and the Engagement note', async () => {
    await setup();
    const nav = fixture.nativeElement.querySelector('[data-testid="members-sub-nav"]');

    for (const section of HEALTH_METRICS_MEMBERS_SECTIONS) {
      expect(fixture.nativeElement.querySelector(`[data-testid="members-sub-nav-${section.key}"]`).textContent).toContain(section.label);
    }
    expect(nav.textContent).not.toMatch(/\d/);
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

  it("badges the breakdown with the selected year's members once it reports them", async () => {
    await setup();
    const item = () => fixture.nativeElement.querySelector('[data-testid="members-sub-nav-breakdown"]').textContent;

    stub(BreakdownStubComponent).countChange.emit(2630);
    await flush();
    expect(item()).toContain('2,630');

    stub(BreakdownStubComponent).countChange.emit(null);
    await flush();
    expect(item()).not.toMatch(/\d/);
  });

  it('badges All members with the directory count once it reports one', async () => {
    await setup();
    const item = () => fixture.nativeElement.querySelector('[data-testid="members-sub-nav-list"]').textContent;

    stub(DirectoryStubComponent).countChange.emit(725);
    await flush();
    expect(item()).toContain('725');

    stub(DirectoryStubComponent).countChange.emit(null);
    await flush();
    expect(item()).not.toMatch(/\d/);
  });

  it('badges Renewals with the renewals due once it reports them', async () => {
    await setup();
    const item = () => fixture.nativeElement.querySelector('[data-testid="members-sub-nav-renewals"]').textContent;

    stub(RenewalsStubComponent).countChange.emit(61);
    await flush();
    expect(item()).toContain('61');

    stub(RenewalsStubComponent).countChange.emit(null);
    await flush();
    expect(item()).not.toMatch(/\d/);
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
