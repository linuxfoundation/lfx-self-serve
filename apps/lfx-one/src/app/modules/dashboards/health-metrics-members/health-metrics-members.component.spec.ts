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
import { MembersBridgeComponent } from './components/members-bridge/members-bridge.component';
import { MembersDirectoryComponent } from './components/members-directory/members-directory.component';
import { MembersTiersComponent } from './components/members-tiers/members-tiers.component';
import { HealthMetricsMembersComponent } from './health-metrics-members.component';

/** Stands in for Membership & revenue by tier, whose read its own spec covers; the test drives its outputs. */
@Component({ selector: 'lfx-members-tiers', template: '<div data-testid="members-tiers-stub"></div>' })
class TiersStubComponent {
  public readonly settled = output<void>();
  public readonly reading = output<void>();
}

/** Stands in for the membership bridge, which reads separately under the same anchor. */
@Component({ selector: 'lfx-members-bridge', template: '<div data-testid="members-bridge-stub"></div>' })
class BridgeStubComponent {
  public readonly settled = output<void>();
  public readonly reading = output<void>();
  public readonly sectionPicked = output<string>();
}

/** Stands in for the members directory; the test drives its count and settle. */
@Component({ selector: 'lfx-members-directory', template: '<div data-testid="members-directory-stub"></div>' })
class DirectoryStubComponent {
  public readonly countChange = output<number | null>();
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
      .overrideComponent(HealthMetricsMembersComponent, {
        remove: { imports: [MembersBridgeComponent, MembersDirectoryComponent, MembersTiersComponent] },
        add: { imports: [BridgeStubComponent, DirectoryStubComponent, TiersStubComponent] },
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

  it('renders the seven sections in order, each anchored with its design copy and a body or placeholder', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="members-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => `sec-mem-${section.key}`));
    rendered.forEach((element, index) => {
      const key = HEALTH_METRICS_MEMBERS_SECTIONS[index].key;
      expect(element.textContent).toContain(HEALTH_METRICS_MEMBERS_SECTIONS[index].heading);
      if (key === 'tiers') {
        expect(element.querySelector('[data-testid="members-tiers-stub"]')).not.toBeNull();
        expect(element.querySelector('[data-testid="members-bridge-stub"]')).not.toBeNull();
        expect(element.textContent).not.toContain('Awaiting data');
      } else if (key === 'list') {
        expect(element.querySelector('[data-testid="members-directory-stub"]')).not.toBeNull();
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

  function stub<T>(type: new (...args: never[]) => T): T {
    return fixture.debugElement.query(By.directive(type)).componentInstance as T;
  }

  async function flush(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('holds a deep link until the tiers, bridge and directory reads settle', async () => {
    await setup('renewals');
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    // Each settle re-lands the held link; it is released only once every data section has settled.
    stub(TiersStubComponent).settled.emit();
    await flush();
    scrollIntoView.mockClear();
    stub(TiersStubComponent).settled.emit();
    await flush();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    stub(BridgeStubComponent).settled.emit();
    stub(DirectoryStubComponent).settled.emit();
    await flush();
    scrollIntoView.mockClear();
    stub(TiersStubComponent).settled.emit();
    await flush();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('members-sub-nav-renewals');
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

  it('scrolls to churn when the bridge picks it', async () => {
    await setup();

    stub(BridgeStubComponent).sectionPicked.emit('churn');
    await flush();

    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('members-sub-nav-churn');
  });
});
