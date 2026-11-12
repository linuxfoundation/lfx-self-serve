// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '@lfx-one/shared/constants';
import { UserService } from '@services/user.service';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { NonMembersConversionComponent } from './components/non-members-conversion/non-members-conversion.component';
import { NonMembersOrgsComponent } from './components/non-members-orgs/non-members-orgs.component';
import { NonMembersPeopleComponent } from './components/non-members-people/non-members-people.component';
import { HealthMetricsNonMembersComponent } from './health-metrics-non-members.component';

/** Stands in for Company participation, whose read its own spec covers; the test drives its outputs. */
@Component({ selector: 'lfx-non-members-orgs', template: '<div data-testid="non-members-orgs-stub"></div>' })
class OrgsStubComponent {
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for Engaged people, whose read its own spec covers. */
@Component({ selector: 'lfx-non-members-people', template: '<div data-testid="non-members-people-stub"></div>' })
class PeopleStubComponent {
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for Conversion opportunity, whose read its own spec covers. */
@Component({ selector: 'lfx-non-members-conversion', template: '<div data-testid="non-members-conversion-stub"></div>' })
class ConversionStubComponent {
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

// Covers only what Non-Members wires into the shell: its copy, section bodies and sub-nav. The
// scroll-spy and deep-link behaviour is the shell's own spec.
describe('HealthMetricsNonMembersComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsNonMembersComponent>;

  async function setup(initialFragment: string | null = null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsNonMembersComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { fragment: new BehaviorSubject<string | null>(initialFragment).asObservable() } },
      ],
    })
      .overrideComponent(HealthMetricsNonMembersComponent, {
        remove: { imports: [NonMembersConversionComponent, NonMembersOrgsComponent, NonMembersPeopleComponent] },
        add: { imports: [ConversionStubComponent, OrgsStubComponent, PeopleStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HealthMetricsNonMembersComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function stub<T>(type: new (...args: never[]) => T): T {
    return fixture.debugElement.query(By.directive(type)).componentInstance as T;
  }

  async function flush(): Promise<void> {
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

  it('renders the three sections in order, each anchored with its design copy and its body', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="non-members-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => `sec-non-${section.key}`));
    rendered.forEach((element, index) => {
      const key = HEALTH_METRICS_NON_MEMBERS_SECTIONS[index].key;
      expect(element.textContent).toContain(HEALTH_METRICS_NON_MEMBERS_SECTIONS[index].heading);
      expect(element.querySelector(`[data-testid="non-members-${key}-stub"]`)).not.toBeNull();
      expect(element.textContent).not.toContain('Awaiting data');
    });
  });

  it('lists every section in the sub-nav, with no note', async () => {
    await setup();
    const nav = fixture.nativeElement.querySelector('[data-testid="non-members-sub-nav"]');

    for (const section of HEALTH_METRICS_NON_MEMBERS_SECTIONS) {
      expect(fixture.nativeElement.querySelector(`[data-testid="non-members-sub-nav-${section.key}"]`).textContent).toContain(section.label);
    }
    expect(nav.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('re-lands a held deep link once every data section settles, then releases it', async () => {
    await setup('conversion');
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();

    stub(OrgsStubComponent).settled.emit(false);
    stub(PeopleStubComponent).settled.emit(false);
    stub(ConversionStubComponent).settled.emit(false);
    await flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('non-members-sub-nav-conversion');

    scrollIntoView.mockClear();
    stub(OrgsStubComponent).settled.emit(false);
    stub(PeopleStubComponent).settled.emit(false);
    stub(ConversionStubComponent).settled.emit(false);
    await flush();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
