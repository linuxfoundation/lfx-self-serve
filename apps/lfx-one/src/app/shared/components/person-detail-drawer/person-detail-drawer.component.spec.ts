// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgAllEmployeeDetail, OrgPersonCompanyEmailsResponse, PersonDrawerContext } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { finalize, Observable, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { PersonDetailDrawerComponent } from './person-detail-drawer.component';

const PEOPLE = '/api/orgs/org-1/lens/people';
const BY_USERNAME = `${PEOPLE}/by-username/first-person`;
const BY_PERSON_KEY = `${PEOPLE}/first-person`;

describe('PersonDetailDrawerComponent activity and company email requests', () => {
  let fixture: ComponentFixture<PersonDetailDrawerComponent>;
  let drawer: PersonDetailDrawerService;
  let responses: Map<string, Subject<unknown>>;
  let httpGet: Mock<(url: string) => Observable<unknown>>;
  const selectedAccount = signal({ uid: 'org-1' });
  const featureEnabled = signal(true);
  const person: PersonDrawerContext = { name: 'First person', username: 'first-person' };
  const detail = (personKey = 'first-person'): OrgAllEmployeeDetail => ({
    personKey,
    boardSeats: [],
    committeeSeats: [],
    code: [],
    events: [
      {
        eventId: 'event-1',
        eventName: 'Member Summit',
        foundationId: 'foundation-1',
        foundationName: 'Foundation One',
        isSpeaker: false,
        eventsCount: 1,
        lastEventEndDate: '2026-02-25',
      },
    ],
    training: [],
  });
  const emails = (companyEmails: string[] = []): OrgPersonCompanyEmailsResponse => ({ companyEmails, companyEmailsStatus: 'resolved' });
  // One subject per URL, created on first request, so each test answers activity and addresses independently.
  const reply = (url: string): Subject<unknown> => {
    let subject = responses.get(url);
    if (!subject) {
      subject = new Subject();
      responses.set(url, subject);
    }
    return subject;
  };
  const requested = (): string[] => httpGet.mock.calls.map(([url]) => url as string);
  const emailState = (state: string): Element | null => document.querySelector(`[data-testid="person-detail-drawer-email${state ? '-' + state : ''}"]`);
  const byTestId = (id: string): Element | null => document.querySelector(`[data-testid="${id}"]`);
  const render = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    selectedAccount.set({ uid: 'org-1' });
    featureEnabled.set(true);
    responses = new Map();
    httpGet = vi.fn((url: string) => reply(url));
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
    { label: 'username', context: person, base: BY_USERNAME },
    { label: 'person key', context: { name: 'First person', personKey: 'first-person' }, base: BY_PERSON_KEY },
  ])('requests $label activity and addresses together and renders activity while addresses are pending', async ({ context, base }) => {
    drawer.open(context);
    // This read is intentionally before the toObservable effects start the HTTP requests.
    expect(drawer.loading()).toBe(true);
    expect(drawer.emailsLoading()).toBe(true);
    expect(httpGet).not.toHaveBeenCalled();
    await render();
    expect(requested().sort()).toEqual([`${base}/company-emails`, `${base}/detail`]);
    expect(emailState('loading')).not.toBeNull();

    reply(`${base}/detail`).next(detail());
    await render();
    expect(drawer.loading()).toBe(false);
    expect(document.body.textContent).toContain('Member Summit');
    expect(emailState('loading')).not.toBeNull();
    expect(emailState('none')).toBeNull();

    reply(`${base}/company-emails`).next(emails());
    await render();
    expect(emailState('loading')).toBeNull();
    expect(emailState('none')).not.toBeNull();
  });

  it('renders addresses that arrive before activity', async () => {
    drawer.open(person);
    await render();
    reply(`${BY_USERNAME}/company-emails`).next(emails(['first@example.org']));
    await render();
    expect(emailState('0')?.textContent?.trim()).toBe('first@example.org');
    expect(byTestId('person-detail-drawer-loading')).not.toBeNull();
  });

  it.each([
    { status: 'failed', state: 'failed' },
    { status: 'unavailable', state: 'not-available' },
    { status: undefined, state: 'failed' },
  ])('does not turn a $status result into addresses or none on record, or retain it for another person', async ({ status, state }) => {
    drawer.open(person);
    await render();
    reply(`${BY_USERNAME}/company-emails`).next({ companyEmails: ['old@example.org'], companyEmailsStatus: status });
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
    reply(`${BY_PERSON_KEY}/detail`).next(detail());
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['first@example.org']));
    await render();
    expect(emailState('0')?.textContent?.trim()).toBe('first@example.org');

    drawer.open({ name: 'Second person', personKey: 'second-person' });
    expect(drawer.companyEmails()).toEqual([]);
    expect(drawer.detail()).toBeNull();
    expect(drawer.companyEmailsResolved()).toBe(false);
    expect(drawer.loading()).toBe(true);
    expect(drawer.emailsLoading()).toBe(true);
    await render();
    expect(emailState('')).toBeNull();
    expect(emailState('none')).toBeNull();

    reply(`${PEOPLE}/second-person/company-emails`).next(emails());
    await render();
    expect(emailState('none')).not.toBeNull();
  });

  it('ignores an old address response before the switch effect runs, then cancels its subscription', async () => {
    const cancelled = vi.fn();
    const firstEmails = new Subject<unknown>();
    responses.set(`${BY_USERNAME}/company-emails`, firstEmails);
    httpGet.mockImplementation((url: string) => (url === `${BY_USERNAME}/company-emails` ? firstEmails.pipe(finalize(cancelled)) : reply(url)));
    drawer.open(person);
    await render();

    drawer.open({ name: 'Second person', username: 'second-person' });
    firstEmails.next(emails(['first@example.org']));
    expect(drawer.companyEmails()).toEqual([]);
    expect(drawer.companyEmailsResolved()).toBe(false);
    await render();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(emailState('')).toBeNull();
    expect(emailState('none')).toBeNull();

    reply(`${PEOPLE}/by-username/second-person/company-emails`).next(emails(['second@example.org']));
    await render();
    expect(emailState('0')?.textContent?.trim()).toBe('second@example.org');
  });

  it('refetches both on account changes, and turning the flag off hides addresses without refetching activity', async () => {
    drawer.open(person);
    await render();
    reply(`${BY_USERNAME}/detail`).next(detail());
    reply(`${BY_USERNAME}/company-emails`).next(emails(['first@example.org']));
    await render();
    expect(emailState('0')).not.toBeNull();

    selectedAccount.set({ uid: 'org-2' });
    expect(drawer.companyEmailsResolved()).toBe(false);
    expect(drawer.loading()).toBe(true);
    await render();
    expect(emailState('0')).toBeNull();
    expect(requested()).toContain('/api/orgs/org-2/lens/people/by-username/first-person/detail');
    expect(requested()).toContain('/api/orgs/org-2/lens/people/by-username/first-person/company-emails');

    const requestCount = httpGet.mock.calls.length;
    featureEnabled.set(false);
    await render();
    expect(httpGet).toHaveBeenCalledTimes(requestCount);
    expect(drawer.emailsLoading()).toBe(false);
    for (const state of ['', 'loading', 'none', 'not-available', 'failed']) {
      expect(emailState(state)).toBeNull();
    }
  });

  it.each([
    { label: 'username', context: person, base: BY_USERNAME },
    { label: 'person key', context: { name: 'First person', personKey: 'first-person' }, base: BY_PERSON_KEY },
  ])('never requests $label addresses while the flag is off', async ({ context, base }) => {
    featureEnabled.set(false);
    drawer.open(context);
    await render();
    expect(requested()).toEqual([`${base}/detail`]);
    expect(emailState('loading')).toBeNull();
  });

  it('keeps missing identity distinct from an empty lookup and a failed detail fetch distinct from addresses', async () => {
    drawer.open({ name: 'Name only' });
    await render();
    expect(httpGet).not.toHaveBeenCalled();
    expect(emailState('not-available')).not.toBeNull();
    expect(emailState('none')).toBeNull();

    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    reply(`${BY_PERSON_KEY}/detail`).error(new HttpErrorResponse({ status: 500 }));
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['first@example.org']));
    await render();
    expect(drawer.error()).toBe(true);
    expect(byTestId('person-detail-drawer-error')).not.toBeNull();
    // A failed activity fetch does not discard addresses that resolved on their own request.
    expect(emailState('0')?.textContent?.trim()).toBe('first@example.org');
  });

  it('reports a failed address lookup without turning it into a detail error', async () => {
    drawer.open(person);
    await render();
    reply(`${BY_USERNAME}/detail`).next(detail());
    reply(`${BY_USERNAME}/company-emails`).error(new HttpErrorResponse({ status: 500 }));
    await render();
    expect(drawer.error()).toBe(false);
    expect(emailState('failed')).not.toBeNull();
    expect(document.body.textContent).toContain('Member Summit');
  });

  it('clears failed activity state synchronously when closing or opening another person', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    reply(`${BY_PERSON_KEY}/detail`).error(new HttpErrorResponse({ status: 500 }));
    await render();
    expect(drawer.error()).toBe(true);

    drawer.close();
    expect(drawer.error()).toBe(false);
    expect(drawer.emailError()).toBe(false);
    expect(drawer.companyEmails()).toEqual([]);
    expect(drawer.companyEmailsResolved()).toBe(false);
    drawer.open(person);
    expect(drawer.error()).toBe(false);
    expect(drawer.loading()).toBe(true);
    await render();
    expect(emailState('none')).toBeNull();
  });

  it('loads activity and governance for a username-only opener (lfx-self-serve-ops#894)', async () => {
    drawer.open(person);
    await render();
    reply(`${BY_USERNAME}/detail`).next({
      ...detail(),
      committeeSeats: [
        {
          committeeId: 'committee-1',
          committeeName: 'Gold Members',
          foundationId: 'foundation-1',
          foundationName: 'Foundation One',
          committeeRole: 'None',
          votingStatus: 'Observer',
          isBoard: false,
        },
      ],
    });
    await render();
    expect(byTestId('person-detail-drawer-detail-unavailable')).toBeNull();
    expect(document.body.textContent).toContain('Member Summit');

    drawer.setTab('governance');
    await render();
    expect(document.body.textContent).toContain('Gold Members');
  });

  it('shows unavailable activity at once for a username that matches no single person, while addresses still load', async () => {
    drawer.open(person);
    await render();
    reply(`${BY_USERNAME}/detail`).next(null);
    await render();
    expect(drawer.loading()).toBe(false);
    expect(byTestId('person-detail-drawer-detail-unavailable')).not.toBeNull();
    expect(emailState('loading')).not.toBeNull();

    reply(`${BY_USERNAME}/company-emails`).next(emails(['first@example.org']));
    await render();
    expect(emailState('0')?.textContent?.trim()).toBe('first@example.org');
    expect(drawer.error()).toBe(false);
  });
});
