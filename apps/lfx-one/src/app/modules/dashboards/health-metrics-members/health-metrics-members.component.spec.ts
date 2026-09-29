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
import { MembersTiersComponent } from './components/members-tiers/members-tiers.component';
import { HealthMetricsMembersComponent } from './health-metrics-members.component';

/** Stands in for Membership & revenue by tier, whose read its own spec covers; the test drives its outputs. */
@Component({ selector: 'lfx-members-tiers', template: '<div data-testid="members-tiers-stub"></div>' })
class TiersStubComponent {
  public readonly settled = output<void>();
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
      .overrideComponent(HealthMetricsMembersComponent, { remove: { imports: [MembersTiersComponent] }, add: { imports: [TiersStubComponent] } })
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

  it('renders the seven sections in order, each anchored with its design copy and a body or placeholder', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="members-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => `sec-mem-${section.key}`));
    rendered.forEach((element, index) => {
      const key = HEALTH_METRICS_MEMBERS_SECTIONS[index].key;
      expect(element.textContent).toContain(HEALTH_METRICS_MEMBERS_SECTIONS[index].heading);
      if (key === 'tiers') {
        expect(element.querySelector('[data-testid="members-tiers-stub"]')).not.toBeNull();
        expect(element.textContent).not.toContain('Awaiting data');
      } else {
        expect(element.textContent).toContain('Awaiting data');
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
    expect(nav.textContent).toContain('Group attendance is in Engagement');
    expect(fixture.nativeElement.querySelector('[data-testid="members-sub-nav-cross-reference-link"]').getAttribute('href')).toBe(
      '/foundation/health-metrics/engagement#committees'
    );
  });

  it('says above the sections that the project selector does not narrow them', async () => {
    await setup();
    const note = fixture.nativeElement.querySelector('[data-testid="members-scope-note"]');

    expect(note.textContent).toContain('foundation-wide');
    expect(note.compareDocumentPosition(fixture.nativeElement.querySelector('[data-testid="health-metrics-members-page"]'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('scrolls to the section a deep link names once the tiers settle', async () => {
    await setup('renewals');
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    // The shell re-lands a held deep link once every data section has settled.
    scrollIntoView.mockClear();
    (fixture.debugElement.query(By.directive(TiersStubComponent)).componentInstance as TiersStubComponent).settled.emit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('members-sub-nav-renewals');
  });
});
