// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ORG_COMMITS_DEFINITION } from '@lfx-one/shared/constants';
import type { OrgAllEmployeeDetail, OrgKeyContactAssignment, OrgPersonCompanyEmailsResponse, PersonDrawerContext } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { Tooltip } from 'primeng/tooltip';
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
  const person: PersonDrawerContext = { name: 'First person', username: 'first-person' };
  const detail = (personKey = 'first-person'): OrgAllEmployeeDetail => ({
    personKey,
    boardSeats: [],
    committeeSeats: [],
    code: [],
    totalCommits: 0,
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
  const emails = (companyEmails: string[] = [], primaryEmail: string | null = null): OrgPersonCompanyEmailsResponse => ({
    companyEmails,
    primaryEmail,
    companyEmailsStatus: 'resolved',
  });
  const assignment: OrgKeyContactAssignment = {
    contactUid: 'contact-1',
    membershipUid: 'membership-1',
    email: 'first.person@vendor-corp.example',
    firstName: 'First',
    lastName: 'Person',
    displayName: 'First Person',
    title: 'Events Manager',
    role: 'Billing Contact',
    foundationSlug: 'foundation-one',
    foundationName: 'Foundation One',
  };
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
    responses = new Map();
    httpGet = vi.fn((url: string) => reply(url));
    await TestBed.configureTestingModule({
      imports: [PersonDetailDrawerComponent],
      providers: [
        provideNoopAnimations(),
        { provide: HttpClient, useValue: { get: httpGet } },
        { provide: AccountContextService, useValue: { selectedAccount } },
      ],
    }).compileComponents();
    drawer = TestBed.inject(PersonDetailDrawerService);
    fixture = TestBed.createComponent(PersonDetailDrawerComponent);
  });

  afterEach(() => {
    fixture?.destroy();
    document.body.innerHTML = '';
    // Cleaning up here, not at the end of the test that stubs: an assertion that fails mid-test would
    // otherwise leave the stub in place for the rest of the file.
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.restoreAllMocks();
  });

  /**
   * Defines only the `clipboard` property. jsdom's navigator has none, and replacing the whole object
   * with `{ ...navigator }` would drop every prototype accessor the rest of the suite may read.
   */
  const stubClipboard = (writeText: (text: string) => Promise<void>): void => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  };

  const liveRegion = (): string => document.querySelector('[role="status"]')?.textContent?.trim() ?? '';

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

  it('tags a former employee with the Former employee badge', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person', isFormer: true });
    await render();

    expect(byTestId('person-detail-drawer-former-badge')?.textContent?.trim()).toBe('Former employee');
  });

  it.each([
    { label: 'isFormer false', context: { name: 'First person', personKey: 'first-person', isFormer: false } },
    { label: 'isFormer absent', context: { name: 'First person', personKey: 'first-person' } },
  ])('shows no Former employee badge with $label', async ({ context }) => {
    drawer.open(context);
    await render();

    expect(byTestId('person-detail-drawer-former-badge')).toBeNull();
  });

  it('drops the Former employee badge when the drawer switches from a former employee to a current one', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person', isFormer: true });
    await render();
    expect(byTestId('person-detail-drawer-former-badge')).not.toBeNull();

    drawer.open({ name: 'Second person', personKey: 'second-person' });
    await render();

    expect(byTestId('person-detail-drawer-former-badge')).toBeNull();
  });

  it('drops the Former employee badge when the account changes, since employment is per organization', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person', isFormer: true });
    await render();
    expect(byTestId('person-detail-drawer-former-badge')).not.toBeNull();

    selectedAccount.set({ uid: 'org-2' });
    await render();

    expect(byTestId('person-detail-drawer-former-badge')).toBeNull();
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

  it('refetches both on account changes', async () => {
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

  it('renders the key contact roles the person holds, foundation-labelled and sorted', async () => {
    drawer.open(person);
    await render();
    drawer.setTab('key-contacts');
    await render();
    reply(`${BY_USERNAME}/key-contacts`).next({
      status: 'resolved',
      assignments: [
        { ...assignment, contactUid: 'contact-2', role: 'Marketing Contact', foundationName: 'Foundation Two' },
        { ...assignment, contactUid: 'contact-1', role: 'Billing Contact', foundationName: 'Foundation One' },
      ],
    });
    await render();

    const rows = [...document.querySelectorAll('[data-testid="person-detail-drawer-key-contacts-list"] li')].map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(rows).toEqual(['Billing ContactFoundation One', 'Marketing ContactFoundation Two']);
    expect(byTestId('person-detail-drawer-key-contacts-empty')).toBeNull();
  });

  it('asks for the roles only once the tab is opened, then keeps them across tab switches', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    // Most drawer opens never visit this tab, and the read costs a company-address lookup.
    expect(requested()).not.toContain(`${BY_PERSON_KEY}/key-contacts`);

    drawer.setTab('key-contacts');
    await render();
    expect(requested()).toContain(`${BY_PERSON_KEY}/key-contacts`);

    drawer.setTab('events');
    await render();
    drawer.setTab('key-contacts');
    await render();
    expect(requested().filter((url) => url === `${BY_PERSON_KEY}/key-contacts`)).toHaveLength(1);
  });

  it('opens straight into the roles request when the opener defaults to that tab', async () => {
    drawer.open({ ...person, defaultTab: 'key-contacts' });
    await render();
    expect(requested()).toContain(`${BY_USERNAME}/key-contacts`);
  });

  // The server resolves the roster username for a person key, so no identity rides in the URL.
  it('never puts a username in the roles request for a person key', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person', username: 'first-person', defaultTab: 'key-contacts' });
    await render();
    expect(requested()).toContain(`${BY_PERSON_KEY}/key-contacts`);
    expect(requested().some((url) => url.includes('username='))).toBe(false);
  });

  // The drawer stays open across an account switch, and every other read drops its stale answer at once.
  // Supplied roles belong to the organization they were read under, so they must not outlive it.
  it('drops opener-supplied roles when the account changes, and fetches for the new one', async () => {
    drawer.open({ ...person, keyContactAssignments: [assignment], defaultTab: 'key-contacts' });
    await render();
    expect(drawer.keyContacts()).toEqual([assignment]);
    expect(requested()).not.toContain(`${BY_USERNAME}/key-contacts`);

    selectedAccount.set({ uid: 'org-2' });
    // Synchronously, before any new response lands: the previous org's roles are already gone.
    expect(drawer.keyContacts()).toEqual([]);
    expect(drawer.keyContactsIdentified()).toBe(false);

    await render();
    expect(requested()).toContain('/api/orgs/org-2/lens/people/by-username/first-person/key-contacts');
    expect(document.body.textContent).not.toContain('Billing Contact');
  });

  it('renders roles supplied by the opener without requesting them', async () => {
    drawer.open({ ...person, keyContactAssignments: [assignment], defaultTab: 'key-contacts' });
    await render();

    expect(requested()).not.toContain(`${BY_USERNAME}/key-contacts`);
    expect(drawer.keyContactsLoading()).toBe(false);
    expect(drawer.keyContactsIdentified()).toBe(true);
    expect(document.body.textContent).toContain('Billing Contact');
  });

  it.each([
    { label: 'an identified person with no roles', response: { status: 'resolved', assignments: [] }, testId: 'empty' },
    { label: 'a person the lookup never identified', response: { status: 'unidentified', assignments: [] }, testId: 'unavailable' },
    { label: 'a lookup that errored upstream', response: { status: 'failed', assignments: [] }, testId: 'error' },
    // A response with no status at all is a failure, never a verified empty list.
    { label: 'a response missing its status', response: { assignments: [] }, testId: 'error' },
  ])('keeps $label distinct in the Key Contacts tab', async ({ response, testId }) => {
    drawer.open(person);
    await render();
    drawer.setTab('key-contacts');
    await render();
    reply(`${BY_USERNAME}/key-contacts`).next(response);
    await render();

    expect(byTestId(`person-detail-drawer-key-contacts-${testId}`)).not.toBeNull();
  });

  it('shows a failed roles read without disturbing the activity tabs', async () => {
    drawer.open(person);
    await render();
    reply(`${BY_USERNAME}/detail`).next(detail());
    drawer.setTab('key-contacts');
    await render();
    reply(`${BY_USERNAME}/key-contacts`).error(new HttpErrorResponse({ status: 500 }));
    await render();
    expect(byTestId('person-detail-drawer-key-contacts-error')).not.toBeNull();

    drawer.setTab('events');
    await render();
    expect(drawer.error()).toBe(false);
    expect(document.body.textContent).toContain('Member Summit');
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

  it('labels the Code tab total "Commits" with the shared commits definition tooltip', async () => {
    drawer.open(person);
    await render();
    reply(`${BY_USERNAME}/detail`).next({
      ...detail(),
      code: [
        {
          projectId: 'project-1',
          projectName: 'Project One',
          foundationId: 'foundation-1',
          foundationName: 'Foundation One',
          commits: 7,
          lastActivityDate: null,
          isMaintainer: false,
        },
      ],
      totalCommits: 7,
    });
    drawer.setTab('code');
    await render();

    expect(byTestId('person-detail-drawer-code-commits-label')?.textContent?.trim()).toBe('Commits');
    const info = fixture.debugElement.query(By.css('[data-testid="person-detail-drawer-code-commits-info"]'));
    expect(info.injector.get(Tooltip).content).toBe(ORG_COMMITS_DEFINITION);
  });

  it("shows a mirrored commit in each project's count and once in the Commits total", async () => {
    drawer.open(person);
    await render();
    const project = (projectId: string, commits: number): OrgAllEmployeeDetail['code'][number] => ({
      projectId,
      projectName: projectId,
      foundationId: 'foundation-1',
      foundationName: 'Foundation One',
      commits,
      lastActivityDate: null,
      isMaintainer: false,
    });
    // 3 commits only in project-1 and 4 mirrored in project-1 and project-2: 7 distinct commits.
    reply(`${BY_USERNAME}/detail`).next({ ...detail(), code: [project('project-1', 7), project('project-2', 4)], totalCommits: 7 });
    drawer.setTab('code');
    await render();

    expect(byTestId('person-detail-drawer-code-commits')?.textContent?.trim()).toBe('7');
    expect(byTestId('person-detail-drawer-code-project-project-1')?.textContent).toContain('7 commits');
    expect(byTestId('person-detail-drawer-code-project-project-2')?.textContent).toContain('4 commits');
  });

  it('says "1 commit" for a project with one commit and "N commits" otherwise', async () => {
    drawer.open(person);
    await render();
    const project = (projectId: string, commits: number): OrgAllEmployeeDetail['code'][number] => ({
      projectId,
      projectName: projectId,
      foundationId: 'foundation-1',
      foundationName: 'Foundation One',
      commits,
      lastActivityDate: null,
      isMaintainer: false,
    });
    reply(`${BY_USERNAME}/detail`).next({ ...detail(), code: [project('project-1', 1), project('project-2', 2)], totalCommits: 3 });
    drawer.setTab('code');
    await render();

    const count = (projectId: string): string => byTestId(`person-detail-drawer-code-project-${projectId}-commits`)?.textContent?.trim() ?? '';
    expect([count('project-1'), count('project-2')]).toEqual(['1 commit', '2 commits']);
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
  it('renders each address as a mailto link and marks the primary one', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['primary@example.org', 'second@example.org'], 'primary@example.org'));
    await render();

    expect(emailState('0')?.getAttribute('href')).toBe('mailto:primary@example.org');
    expect(emailState('1')?.getAttribute('href')).toBe('mailto:second@example.org');
    // One marker, on the primary's own line.
    const markers = document.querySelectorAll('[data-testid="person-detail-drawer-email-primary"]');
    expect(markers).toHaveLength(1);
    expect(markers[0].closest('span')?.parentElement?.textContent).toContain('primary@example.org');
  });

  it('marks no address primary when the warehouse flags none', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['first@example.org']));
    await render();

    expect(emailState('0')?.getAttribute('href')).toBe('mailto:first@example.org');
    expect(byTestId('person-detail-drawer-email-primary')).toBeNull();
  });

  it('copies an address and confirms it, without confirming the others', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['first@example.org', 'second@example.org']));
    await render();

    (byTestId('person-detail-drawer-email-copy-1') as HTMLButtonElement).click();
    await render();
    expect(writeText).toHaveBeenCalledWith('second@example.org');
    expect(liveRegion()).toBe('second@example.org copied');
  });

  /**
   * Copies first@example.org as "First person", then runs `switchAway`. Every case answers the
   * follow-up company-emails request: the live region sits inside `@if (companyEmails().length)`, so
   * asserting on an empty address list would pass with no guard in place at all.
   */
  const copyThenSwitch = async (switchAway: () => void, nextEmailsUrl: string): Promise<void> => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['first@example.org']));
    await render();
    (byTestId('person-detail-drawer-email-copy-0') as HTMLButtonElement).click();
    await render();
    expect(liveRegion()).toBe('first@example.org copied');

    switchAway();
    await render();
    reply(nextEmailsUrl).next(emails(['next@example.org']));
    await render();
    // The new person's addresses are on screen, so the region is rendered — an empty one here is the guard.
    expect(emailState('0')).not.toBeNull();
  };

  it('drops a copy confirmation when the drawer switches to another person', async () => {
    await copyThenSwitch(() => drawer.open({ name: 'Second person', personKey: 'second-person' }), `${PEOPLE}/second-person/company-emails`);

    expect(liveRegion()).toBe('');
  });

  it('drops a copy confirmation when the account switches', async () => {
    await copyThenSwitch(() => selectedAccount.set({ uid: 'org-2' }), '/api/orgs/org-2/lens/people/first-person/company-emails');

    expect(liveRegion()).toBe('');
  });

  it('drops a copy confirmation when the drawer closes and the same person is opened again', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['first@example.org']));
    await render();
    (byTestId('person-detail-drawer-email-copy-0') as HTMLButtonElement).click();
    await render();
    expect(liveRegion()).toBe('first@example.org copied');

    // Reopening is its own context object, so the confirmation does not come back with the person.
    drawer.close();
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    // Reopening resubscribes, and the subject only reaches live subscribers — answer it again so the
    // region is actually on screen when the assertion runs.
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['first@example.org']));
    await render();
    expect(emailState('0')).not.toBeNull();
    expect(liveRegion()).toBe('');
  });

  it('ignores a clipboard write that settles after the drawer moved to another person', async () => {
    let settle: () => void = () => undefined;
    stubClipboard(() => new Promise<void>((resolve) => (settle = resolve)));
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['first@example.org']));
    await render();
    (byTestId('person-detail-drawer-email-copy-0') as HTMLButtonElement).click();
    await render();
    expect(liveRegion()).toBe('');

    drawer.open({ name: 'Second person', personKey: 'second-person' });
    settle();
    await render();
    reply(`${PEOPLE}/second-person/company-emails`).next(emails(['second@example.org']));
    await render();

    // The write belonged to the person who is no longer shown; the new one must not inherit it.
    expect(emailState('0')?.textContent?.trim()).toBe('second@example.org');
    expect(liveRegion()).toBe('');
  });

  it('shows an address carrying URI delimiters as text rather than a mailto link that mails the wrong recipient', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['tag#team@example.org', 'plain@example.org']));
    await render();

    expect(emailState('0')?.tagName).toBe('SPAN');
    expect(emailState('0')?.textContent?.trim()).toBe('tag#team@example.org');
    expect(emailState('0')?.getAttribute('href')).toBeNull();
    // Still copyable, and the safe address beside it still links.
    expect(byTestId('person-detail-drawer-email-copy-0')).not.toBeNull();
    expect(emailState('1')?.getAttribute('href')).toBe('mailto:plain@example.org');
  });

  it('requests and shows addresses with no feature flag configured', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();

    expect(requested()).toContain(`${BY_PERSON_KEY}/company-emails`);
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails(['first@example.org']));
    await render();
    expect(emailState('0')?.getAttribute('href')).toBe('mailto:first@example.org');
  });

  it('says none on record rather than nothing when the lookup resolves empty', async () => {
    drawer.open({ name: 'First person', personKey: 'first-person' });
    await render();
    reply(`${BY_PERSON_KEY}/company-emails`).next(emails());
    await render();

    expect(emailState('none')).not.toBeNull();
    expect(emailState('0')).toBeNull();
  });
});
