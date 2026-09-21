// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ORG_LENS_EMPTY_STATE_COPY } from '@lfx-one/shared/constants';
import { OrgLensEmptyStateActionKind, OrgLensEmptyStateName, OrgLensEmptyStateValues } from '@lfx-one/shared/interfaces';
import { IntercomService } from '@services/intercom.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgLensEmptyStateComponent } from './org-lens-empty-state.component';

const TEST_ID = 'probe';

function render(state: OrgLensEmptyStateName, values: OrgLensEmptyStateValues = {}): ComponentFixture<OrgLensEmptyStateComponent> {
  const fixture = TestBed.createComponent(OrgLensEmptyStateComponent);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('testId', TEST_ID);
  fixture.componentRef.setInput('values', values);
  fixture.detectChanges();
  return fixture;
}

function byTestId(fixture: ComponentFixture<unknown>, suffix: string): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${TEST_ID}-${suffix}"]`);
}

/** The control each action kind renders — a registry entry naming a kind with no branch here is dead data. */
const CONTROL_BY_KIND: Record<OrgLensEmptyStateActionKind, string> = {
  retry: 'retry',
  'reset-filters': 'reset-filters',
  'contact-support': 'contact-support',
  'org-list': 'org-list',
};

const ORG_LIST = [
  { uid: 'a', name: 'Alpha' },
  { uid: 'b', name: 'Beta' },
];

describe('OrgLensEmptyStateComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), MessageService, { provide: IntercomService, useValue: { show: vi.fn() } }],
    });
  });

  it('renders a control for every primary action in the registry', () => {
    for (const [state, copy] of Object.entries(ORG_LENS_EMPTY_STATE_COPY) as [
      OrgLensEmptyStateName,
      (typeof ORG_LENS_EMPTY_STATE_COPY)[OrgLensEmptyStateName],
    ][]) {
      if (!copy.primary) {
        continue;
      }
      const fixture = render(state, { orgList: ORG_LIST, filterActive: true });
      const suffix = copy.primary.action ? CONTROL_BY_KIND[copy.primary.action] : 'primary';
      expect(byTestId(fixture, suffix), `${state} renders its primary (${suffix})`).not.toBeNull();
      fixture.destroy();
    }
  });

  it('renders the held-organization list as the wrong-organization primary and emits the pick', () => {
    const fixture = render('wrong-organization', { orgList: ORG_LIST });
    const picked: string[] = [];
    fixture.componentInstance.orgSelected.subscribe((uid) => picked.push(uid));

    expect(byTestId(fixture, 'primary')?.textContent?.trim()).toBe('Your organizations');
    expect(byTestId(fixture, 'org-list')?.querySelectorAll('li')).toHaveLength(2);
    byTestId(fixture, 'org-b')?.dispatchEvent(new Event('click'));

    expect(picked).toEqual(['b']);
  });

  it('lists the caller\u2019s organizations beneath the staff invite without making them the primary', () => {
    const fixture = render('not-found-staff', { orgList: ORG_LIST });

    expect(byTestId(fixture, 'org-list')).not.toBeNull();
    expect(byTestId(fixture, 'primary')?.textContent).toContain('Go to Organization Lens');
  });

  it('ignores an organization list on states that do not render one', () => {
    const fixture = render('no-access', { orgList: ORG_LIST });

    expect(byTestId(fixture, 'org-list')).toBeNull();
  });

  // FR-017 / spec 050 DR-002: an unheld organization is never named, whatever the caller passed.
  it('never interpolates the organization name into an unheld state', () => {
    for (const state of ['no-access', 'wrong-organization', 'section-no-access', 'section-could-not-verify'] as OrgLensEmptyStateName[]) {
      const fixture = render(state, { orgName: 'Acme Corp' });
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Acme Corp');
      fixture.destroy();
    }
  });

  it('interpolates the organization name, noun and period for a held section', () => {
    const fixture = render('section-empty', { orgName: 'Acme Corp', noun: 'meetings', period: 'the last 30 days' });

    expect(byTestId(fixture, 'title')?.textContent?.trim()).toBe('No meetings in this period');
    expect(byTestId(fixture, 'description')?.textContent).toContain('Acme Corp has no meetings recorded for the last 30 days');
  });

  // FR-013: no selectable period ⇒ the "recorded" wording; no caller-set filter ⇒ no button.
  it('renders the no-period wording and drops the reset button when no filter narrows the section', () => {
    const fixture = render('section-empty', { orgName: 'Acme Corp', noun: 'ROI records', period: null, filterActive: false });

    expect(byTestId(fixture, 'title')?.textContent?.trim()).toBe('No ROI records recorded');
    expect(byTestId(fixture, 'reset-filters')).toBeNull();
  });

  it('renders the correlation reference on the staff-check state and a dash when none is known', () => {
    expect(byTestId(render('staff-check-failed', { correlationId: 'ref-123' }), 'description')?.textContent).toContain('Reference: ref-123');
    expect(byTestId(render('staff-check-failed'), 'description')?.textContent).toContain('Reference: —');
  });

  // FR-002: the product line is for first-time visitors of a page-level state, not for a section inside a page.
  it('shows the product line only on page-level states', () => {
    expect(byTestId(render('no-organization'), 'product-line')).not.toBeNull();
    expect(byTestId(render('section-could-not-load'), 'product-line')).toBeNull();
  });

  it('emits retry and resetFilters from their controls', () => {
    const retried = vi.fn();
    const reset = vi.fn();
    const retryFixture = render('could-not-load');
    retryFixture.componentInstance.retry.subscribe(retried);
    byTestId(retryFixture, 'retry')?.querySelector('button')?.click();

    const resetFixture = render('section-empty', { filterActive: true });
    resetFixture.componentInstance.resetFilters.subscribe(reset);
    byTestId(resetFixture, 'reset-filters')?.querySelector('button')?.click();

    expect(retried).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
