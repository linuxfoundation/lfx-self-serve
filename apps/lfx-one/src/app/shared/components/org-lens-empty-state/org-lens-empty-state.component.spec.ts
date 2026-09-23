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
    // #2533 mockup: the rows come first and the label follows; the label is not a control.
    const list = byTestId(fixture, 'org-list') as HTMLElement;
    const label = byTestId(fixture, 'primary') as HTMLElement;
    expect(list.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(byTestId(fixture, 'primary')?.closest('a, button')).toBeNull();
    byTestId(fixture, 'org-b')?.dispatchEvent(new Event('click'));

    expect(picked).toEqual(['b']);
  });

  // A shared component must never render a state with no control: an `org-list` primary with nothing
  // to list promotes the secondary into the primary slot (and does not render it twice).
  it('promotes the secondary when the wrong-organization list is empty', () => {
    const fixture = render('wrong-organization', { orgList: [] });

    expect(byTestId(fixture, 'org-list')).toBeNull();
    const controls = (fixture.nativeElement as HTMLElement).querySelectorAll(`[data-testid="${TEST_ID}-contact-support"]`);
    expect(controls).toHaveLength(1);
    expect(controls[0].textContent).toContain('Ask for access to the organization in this link');
    expect(controls[0].tagName).toBe('LFX-BUTTON');
    // The reason must not introduce a list that is not there.
    expect(byTestId(fixture, 'description')?.textContent?.trim()).toBe('This link points to an organization that is not on your list.');
    expect(byTestId(render('wrong-organization', { orgList: ORG_LIST }), 'description')?.textContent).toContain('Here is what you do have access to:');
  });

  // #2535: an unrecognised state must never yield a blank page; the closed name set is compile-time only.
  it('falls closed to a generic could-not-load block for an unrecognised state name', () => {
    const fixture = render('not-a-real-state' as OrgLensEmptyStateName);

    expect(byTestId(fixture, 'title')?.textContent?.trim()).toBe('This section could not be loaded');
    expect(byTestId(fixture, 'retry')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('access');
  });

  it('disables the Retry control while the retry is in flight', () => {
    const fixture = TestBed.createComponent(OrgLensEmptyStateComponent);
    fixture.componentRef.setInput('state', 'could-not-load');
    fixture.componentRef.setInput('testId', TEST_ID);
    fixture.componentRef.setInput('retrying', true);
    fixture.detectChanges();

    expect(byTestId(fixture, 'retry')?.querySelector('button')?.disabled).toBe(true);
  });

  // Staff reach any organization through switcher search, so their not-found state lists none.
  it('does not list the caller\u2019s organizations on the staff not-found state', () => {
    const fixture = render('not-found-staff', { orgList: ORG_LIST });

    expect(byTestId(fixture, 'org-list')).toBeNull();
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

  // FR-002: the reason opens with what Organization Lens is on the two states a first-time visitor
  // can reach — and nowhere else.
  it('opens the reason with the product sentence only on no-organization and no-access', () => {
    expect(byTestId(render('no-organization'), 'description')?.textContent).toContain('Organization Lens shows how a company shows up in open source');
    expect(byTestId(render('no-access'), 'description')?.textContent).toContain("Organization Lens shows a company's open source footprint");
    const others = (Object.keys(ORG_LENS_EMPTY_STATE_COPY) as OrgLensEmptyStateName[]).filter((name) => name !== 'no-organization' && name !== 'no-access');
    expect(others).toHaveLength(8);
    for (const name of others) {
      const fixture = render(name, { orgList: ORG_LIST, filterActive: true });
      expect(byTestId(fixture, 'description')?.textContent, name).not.toContain('Organization Lens shows');
      fixture.destroy();
    }
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
