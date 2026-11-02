// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import type { OrgAccessListResponse, OrgAccessUser, OrgEmploymentFilter } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensAccessService } from '@services/org-lens-access.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgLensAccessComponent } from './org-lens-access.component';

const MARKUP_NAME = '<img src="https://h.example/p.gif"><a href="https://h.example">x</a>';

function accessUser(overrides: Partial<OrgAccessUser>): OrgAccessUser {
  return {
    email: 'ada@acme-motors.example',
    username: 'ada',
    name: 'Ada Lovelace',
    initials: 'AL',
    avatarUrl: null,
    jobTitle: null,
    role: 'admin',
    inviteStatus: 'accepted',
    isPending: false,
    isFormer: false,
    ...overrides,
  };
}

let fixture: ComponentFixture<OrgLensAccessComponent>;

afterEach(() => fixture?.destroy());

async function settle(): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function mount(users: OrgAccessUser[], initialUrl = '/', overrides: Partial<OrgAccessListResponse> = {}): Promise<void> {
  const list: OrgAccessListResponse = {
    orgUid: SYNTHETIC_ORG_ACCOUNT_ID,
    users,
    summary: {
      totalUsers: users.length,
      administrators: users.filter((u) => !u.isPending && u.role === 'admin').length,
      viewers: users.filter((u) => !u.isPending && u.role === 'viewer').length,
    },
    canManage: true,
    ...overrides,
  };
  await TestBed.configureTestingModule({
    imports: [OrgLensAccessComponent],
    providers: [
      provideNoopAnimations(),
      provideRouter([]),
      ConfirmationService,
      { provide: MessageService, useValue: { add: vi.fn() } },
      { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: SYNTHETIC_ORG_ACCOUNT_ID, accountName: SYNTHETIC_ORG_NAME }) } },
      { provide: OrgLensAccessService, useValue: { getAccessUsers: vi.fn(() => of(list)) } },
      { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
    ],
  }).compileComponents();

  await TestBed.inject(Router).navigateByUrl(initialUrl);
  fixture = TestBed.createComponent(OrgLensAccessComponent);
  await settle();
}

describe('OrgLensAccessComponent — remove confirmation', () => {
  it('renders a markup-bearing display name as literal text, creating no elements from it', async () => {
    const target = accessUser({ email: 'grace@acme-motors.example', username: 'grace', name: MARKUP_NAME, role: 'viewer' });
    await mount([accessUser({}), target]);

    (fixture.componentInstance as unknown as { confirmRemove(user: OrgAccessUser): void }).confirmRemove(target);
    fixture.detectChanges();
    await fixture.whenStable();

    // Queried by PrimeNG's own class rather than our template's test id, so a regression back to the
    // default [innerHTML] message still finds the dialog and fails on the injected elements.
    const dialog = document.body.querySelector<HTMLElement>('.p-confirmdialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('img')).toBeNull();
    expect(dialog?.querySelector('a')).toBeNull();
    expect(dialog?.querySelector('[data-testid="org-lens-access-remove-confirm-message"]')?.textContent).toContain(MARKUP_NAME);
  });
});

// lfx-self-serve#4627 — the Employment filter: current employees, former employees who still hold access, or everyone.
describe('OrgLensAccessComponent — employment filter', () => {
  const CURRENT = accessUser({ email: 'ada@acme-motors.example', username: 'ada', name: 'Ada Lovelace' });
  const FORMER = accessUser({ email: 'grace@acme-motors.example', username: 'grace', name: 'Grace Hopper', role: 'viewer', isFormer: true });
  const INVITE = accessUser({
    email: 'invitee@acme-motors.example',
    username: null,
    name: 'Pending Invitee',
    role: 'viewer',
    inviteStatus: 'pending',
    isPending: true,
  });

  const el = (): HTMLElement => fixture.nativeElement;
  const router = (): Router => TestBed.inject(Router);
  const clear = (): HTMLButtonElement | null => el().querySelector('[data-testid="org-access-clear-filters"]');
  const listed = (): string[] =>
    Array.from(el().querySelectorAll('[data-testid^="org-access-row-"]')).map((row) => row.getAttribute('data-testid')?.slice('org-access-row-'.length) ?? '');
  const component = (): { employment: () => OrgEmploymentFilter; onEmploymentChange(value: OrgEmploymentFilter): void } =>
    fixture.componentInstance as unknown as { employment: () => OrgEmploymentFilter; onEmploymentChange(value: OrgEmploymentFilter): void };

  async function pick(employment: OrgEmploymentFilter): Promise<void> {
    component().onEmploymentChange(employment);
    await settle();
  }

  it('offers an Employment dropdown showing All employees by default, listing everyone with no Clear filters', async () => {
    await mount([CURRENT, FORMER, INVITE], '/?tab=access');

    const labelled = el().querySelector('[data-testid="org-access-employment-filter"] [aria-label="Employment"]');
    expect(labelled?.textContent?.trim()).toBe('All employees');
    expect((fixture.componentInstance as unknown as { employmentOptions: { label: string }[] }).employmentOptions.map((option) => option.label)).toEqual([
      'Current employees',
      'Former employees',
      'All employees',
    ]);
    expect(listed()).toEqual([CURRENT.email, FORMER.email, INVITE.email]);
    expect(router().url).toBe('/?tab=access');
    expect(clear()).toBeNull();
  });

  it('lists current employees under Current, former employees who still hold access under Former, and a pending invite only under All employees', async () => {
    await mount([CURRENT, FORMER, INVITE], '/?tab=access');

    await pick('current');
    expect(listed()).toEqual([CURRENT.email]);

    await pick('former');
    expect(listed()).toEqual([FORMER.email]);

    await pick('all');
    expect(listed()).toEqual([CURRENT.email, FORMER.email, INVITE.email]);
  });

  it('writes a pick to ?employment= and drops it again at All employees', async () => {
    await mount([CURRENT, FORMER, INVITE], '/?tab=access');

    await pick('former');
    expect(router().url).toBe('/?tab=access&employment=former');

    await pick('all');
    expect(router().url).toBe('/?tab=access');
  });

  it('opens on ?employment= and follows a query-only navigation without navigating again', async () => {
    await mount([CURRENT, FORMER, INVITE], '/?tab=access&employment=current');
    expect(component().employment()).toBe('current');
    expect(listed()).toEqual([CURRENT.email]);

    const navigate = vi.spyOn(router(), 'navigate');
    await router().navigateByUrl('/?tab=access&employment=former');
    await settle();

    expect(component().employment()).toBe('former');
    expect(listed()).toEqual([FORMER.email]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reads an unknown ?employment= as All employees', async () => {
    await mount([CURRENT, FORMER, INVITE], '/?tab=access&employment=everyone');

    expect(component().employment()).toBe('all');
    expect(listed()).toEqual([CURRENT.email, FORMER.email, INVITE.email]);
  });

  it('Clear filters resets employment to All employees with the search and type filter, and drops the param', async () => {
    await mount([CURRENT, FORMER, INVITE], '/?tab=access&employment=former');
    (fixture.componentInstance as unknown as { searchTerm: { set(value: string): void } }).searchTerm.set('grace');
    await settle();

    clear()?.click();
    await settle();

    expect(component().employment()).toBe('all');
    expect(listed()).toEqual([CURRENT.email, FORMER.email, INVITE.email]);
    expect(router().url).toBe('/?tab=access');
    expect(clear()).toBeNull();
  });

  it('reads an empty Former list as filtered, not as an organization with no access', async () => {
    await mount([CURRENT, INVITE], '/?tab=access&employment=former');

    expect(el().querySelector('[data-testid="org-access-empty"]')?.textContent).toContain('No users match the current search or filter.');
  });

  it('warns under Current or Former, not under All employees, when the former employees could not be read', async () => {
    const unflagged = { ...FORMER, isFormer: false };
    await mount([CURRENT, unflagged, INVITE], '/?tab=access&employment=former', { employmentUnavailable: true });
    const warning = (): Element | null => el().querySelector('[data-testid="org-access-employment-unavailable"]');

    expect(warning()?.textContent).toContain("Former employees couldn't be identified right now");

    await pick('current');
    expect(warning()).not.toBeNull();

    await pick('all');
    expect(warning()).toBeNull();
  });

  it('shows no warning when the former employees were read', async () => {
    await mount([CURRENT, FORMER, INVITE], '/?tab=access&employment=former');

    expect(el().querySelector('[data-testid="org-access-employment-unavailable"]')).toBeNull();
  });
});
