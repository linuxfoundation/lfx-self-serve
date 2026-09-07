// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgAllEmployeeDetail, OrgPersonCompanyEmailsResponse, PersonDrawerContext } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { finalize, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersonDetailDrawerComponent } from './person-detail-drawer.component';

describe('PersonDetailDrawerComponent company email transitions', () => {
  let fixture: ComponentFixture<PersonDetailDrawerComponent>;
  let drawer: PersonDetailDrawerService;
  let response: Subject<OrgAllEmployeeDetail | OrgPersonCompanyEmailsResponse>;
  let httpGet: ReturnType<typeof vi.fn>;
  const selectedAccount = signal({ uid: 'org-1' });
  const featureEnabled = signal(true);
  const person: PersonDrawerContext = { name: 'First person', username: 'first-person' };
  const detail = (companyEmails: string[] = []): OrgAllEmployeeDetail => ({
    personKey: 'first-person',
    boardSeats: [],
    committeeSeats: [],
    code: [],
    events: [],
    training: [],
    companyEmails,
    companyEmailsStatus: 'resolved',
  });
  const emailState = (state: string): Element | null => document.querySelector(`[data-testid="person-detail-drawer-email${state ? '-' + state : ''}"]`);
  const render = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    selectedAccount.set({ uid: 'org-1' });
    featureEnabled.set(true);
    response = new Subject();
    httpGet = vi.fn().mockReturnValue(response);
    await TestBed.configureTestingModule({
      imports: [PersonDetailDrawerComponent],
      providers: [
        provideNoopAnimations(),
        { provide: HttpClient, useValue: { get: httpGet } },
        { provide: AccountContextService, useValue: { selectedAccount } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => featureEnabled } },
      ],
    }).compileComponents();
    drawer = TestBed.inject(PersonDetailDrawerService);
    fixture = TestBed.createComponent(PersonDetailDrawerComponent);
  });

  afterEach(() => {
    fixture?.destroy();
    document.body.innerHTML = '';
  });

  it.each([
    { label: 'username', context: person, payload: { companyEmails: [], companyEmailsStatus: 'resolved' } as OrgPersonCompanyEmailsResponse },
    { label: 'person key', context: { name: 'First person', personKey: 'first-person' }, payload: detail() },
  ])('waits for a resolved $label lookup before asserting none on record', async ({ context, payload }) => {
    drawer.open(context);
    // This read is intentionally before the toObservable effect starts the HTTP request.
    expect(drawer.loading()).toBe(true);
    expect(drawer.companyEmailsResolved()).toBe(false);
    expect(httpGet).not.toHaveBeenCalled();
    await render();
    expect(emailState('none')).toBeNull();

    response.next(payload);
    await render();
    expect(emailState('none')).not.toBeNull();
  });

  it.each([
    { status: 'failed', state: 'failed' },
    { status: 'unavailable', state: 'not-available' },
    { status: undefined, state: 'failed' },
  ])('does not turn a $status result into none on record or retain it for another person', async ({ status, state }) => {
    drawer.open(person);
    await render();
    response.next({ companyEmails: ['old@example.org'], companyEmailsStatus: status } as OrgPersonCompanyEmailsResponse);
    await render();
    expect(emailState(state)).not.toBeNull();
    expect(emailState('none')).toBeNull();
    expect(emailState('')).toBeNull();

    drawer.open({ name: 'Second person', username: 'second-person' });
    expect(drawer.emailError()).toBe(false);
    expect(drawer.identityUnavailable()).toBe(false);
    expect(drawer.companyEmailsResolved()).toBe(false);
    await render();
    expect(emailState(state)).toBeNull();
    expect(emailState('none')).toBeNull();
  });

  it('invalidates resolved addresses and activity synchronously when switching people', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    response.next(detail(['first@example.org']));
    await render();
    expect(emailState('0')?.textContent?.trim()).toBe('first@example.org');

    drawer.open({ name: 'Second person', personKey: 'second-person' });
    expect(drawer.companyEmails()).toEqual([]);
    expect(drawer.detail()).toBeNull();
    expect(drawer.companyEmailsResolved()).toBe(false);
    expect(drawer.loading()).toBe(true);
    await render();
    expect(emailState('')).toBeNull();
    expect(emailState('none')).toBeNull();

    response.next({ ...detail(), personKey: 'second-person' });
    await render();
    expect(emailState('none')).not.toBeNull();
  });

  it('ignores an old response before the switch effect runs, then cancels its subscription', async () => {
    const cancelled = vi.fn();
    httpGet.mockReturnValueOnce(response.pipe(finalize(cancelled)));
    drawer.open(person);
    await render();

    const secondResponse = new Subject<OrgPersonCompanyEmailsResponse>();
    httpGet.mockReturnValue(secondResponse);
    drawer.open({ name: 'Second person', username: 'second-person' });
    response.next({ companyEmails: ['first@example.org'], companyEmailsStatus: 'resolved' });
    expect(drawer.companyEmails()).toEqual([]);
    expect(drawer.companyEmailsResolved()).toBe(false);
    await render();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(emailState('')).toBeNull();
    expect(emailState('none')).toBeNull();

    secondResponse.next({ companyEmails: ['second@example.org'], companyEmailsStatus: 'resolved' });
    await render();
    expect(emailState('0')?.textContent?.trim()).toBe('second@example.org');
  });

  it('invalidates an empty result on account changes and suppresses email lookup when the flag turns off', async () => {
    drawer.open(person);
    await render();
    response.next({ companyEmails: [], companyEmailsStatus: 'resolved' });
    await render();
    expect(emailState('none')).not.toBeNull();

    selectedAccount.set({ uid: 'org-2' });
    expect(drawer.companyEmailsResolved()).toBe(false);
    expect(drawer.loading()).toBe(true);
    await render();
    expect(emailState('none')).toBeNull();
    expect(httpGet).toHaveBeenLastCalledWith('/api/orgs/org-2/lens/people/by-username/first-person/company-emails');

    const requestCount = httpGet.mock.calls.length;
    featureEnabled.set(false);
    expect(drawer.companyEmailsResolved()).toBe(false);
    await render();
    expect(httpGet).toHaveBeenCalledTimes(requestCount);
    expect(emailState('none')).toBeNull();
    expect(emailState('not-available')).toBeNull();
    expect(emailState('failed')).toBeNull();
  });

  it('keeps missing identity and failed detail fetches distinct from an empty lookup', async () => {
    drawer.open({ name: 'Name only' });
    await render();
    expect(httpGet).not.toHaveBeenCalled();
    expect(emailState('not-available')).not.toBeNull();
    expect(emailState('none')).toBeNull();

    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    response.error(new Error('Request failed'));
    await render();
    expect(drawer.error()).toBe(true);
    expect(emailState('none')).toBeNull();
    expect(document.querySelector('[data-testid="person-detail-drawer-error"]')).not.toBeNull();
  });

  it('clears failed activity state synchronously when closing or opening another person', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    response.error(new Error('Request failed'));
    await render();
    expect(drawer.error()).toBe(true);

    drawer.close();
    expect(drawer.error()).toBe(false);
    expect(drawer.emailError()).toBe(false);
    expect(drawer.companyEmails()).toEqual([]);
    expect(drawer.companyEmailsResolved()).toBe(false);
    httpGet.mockReturnValue(new Subject());
    drawer.open(person);
    expect(drawer.error()).toBe(false);
    expect(drawer.loading()).toBe(true);
    await render();
    expect(emailState('none')).toBeNull();
  });
});
