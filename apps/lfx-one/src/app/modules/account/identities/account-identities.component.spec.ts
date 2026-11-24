// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { ACCOUNT_IDENTITIES_COPY } from '@lfx-one/shared/constants';
import { EnrichedIdentity } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountIdentitiesComponent } from './account-identities.component';
import { AccountRemoveIdentityDialogComponent } from './components/remove-identity-dialog/account-remove-identity-dialog.component';

const row = (overrides: Partial<EnrichedIdentity>): EnrichedIdentity =>
  ({ platform: 'github', type: 'username', icon: 'fa-brands fa-github', displayState: 'verified', isPrimary: false, ...overrides }) as EnrichedIdentity;

const IDENTITIES = [
  row({ id: 'primary', platform: 'email', type: 'email', value: 'ada@example.com', icon: 'fa-light fa-envelope', isPrimary: true }),
  row({ id: 'invite', platform: 'email', type: 'email', value: 'invites@example.com', icon: 'fa-light fa-envelope' }),
  row({ id: 'github', value: 'ada-gh' }),
  row({ id: 'gitlab', platform: 'gitlab', value: 'ada-gl', icon: 'fa-brands fa-gitlab', displayState: 'unverified' }),
];

/** State-only page: no template, so these tests cost no render. Providers are not inherited, so the page's own is repeated. */
@Component({ selector: 'lfx-test-account-identities', template: '', providers: [DialogService] })
class StateIdentitiesComponent extends AccountIdentitiesComponent {}

describe('AccountIdentitiesComponent', () => {
  async function render(
    identities: EnrichedIdentity[] = IDENTITIES,
    invite$: Observable<unknown> = of({ email_id: 'invite', email: 'invites@example.com' }),
    state = false
  ) {
    const closed = new Subject<boolean>();
    const open = vi.fn(() => ({ closed }));
    const userService = {
      impersonating: signal(false),
      identitiesRefresh$: EMPTY,
      getIdentities: vi.fn(() => of(identities)),
      getMeetingInviteEmail: vi.fn(() => invite$),
      getLinuxAlias: vi.fn(() => EMPTY),
      refreshUserIdentities: vi.fn(),
      rejectIdentity: vi.fn(() => of({})),
    };
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
        { provide: UserService, useValue: userService },
        { provide: MessageService, useValue: { add: vi.fn(), messageObserver: EMPTY, clearObserver: EMPTY } },
        { provide: UiModalService, useValue: { open } },
      ],
    });
    const fixture = TestBed.createComponent(state ? StateIdentitiesComponent : AccountIdentitiesComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    const click = async (testId: string) => {
      (query(testId)?.querySelector('button') ?? query(testId))?.click();
      await fixture.whenStable();
    };
    return { fixture, host, query, click, open, closed, userService };
  }

  it('groups the identities, flags the primary one, and keeps Linux.com email below for now', async () => {
    const { query } = await render();

    expect(query('account-identities-unverified')?.textContent).toContain('Unverified identities');
    expect(query('account-identities-unverified-note')?.textContent?.trim()).toBe(ACCOUNT_IDENTITIES_COPY.unverifiedNote);
    expect(query('account-identities-row-gitlab')?.textContent).toContain('This is not me');
    expect(query('account-identities-row-primary')?.querySelector('[data-testid="account-identities-primary-badge"]')).not.toBeNull();
    expect(query('account-identities-add')).not.toBeNull();
    expect(query('account-identities-linux-email-title')?.textContent?.trim()).toBe('Linux.com email');
  });

  it('explains why the primary and meeting-invite emails cannot be removed', async () => {
    const { fixture } = await render(IDENTITIES, undefined, true);
    const reasons = fixture.componentInstance['removeBlockedReasons']();

    expect(reasons.get('primary')).toBe(ACCOUNT_IDENTITIES_COPY.primaryEmailRemoveReason);
    expect(reasons.get('invite')).toContain('set for meeting invitations');
    expect(reasons.has('github')).toBe(false);
  });

  it('blocks every email but the primary one when the meeting-invite address cannot be loaded', async () => {
    const { fixture } = await render(
      IDENTITIES,
      throwError(() => new Error('down')),
      true
    );
    const reasons = fixture.componentInstance['removeBlockedReasons']();

    expect(reasons.get('invite')).toContain('Could not confirm your meeting-invitation email');
    expect(reasons.get('primary')).toBe(ACCOUNT_IDENTITIES_COPY.primaryEmailRemoveReason);
    expect(reasons.has('github')).toBe(false);
  });

  it('offers to add one when there are none', async () => {
    const { query, click, open } = await render([]);

    expect(query('account-identities-empty')?.textContent).toContain('No identities found');
    expect(query('account-identities-add')).toBeNull();
    await click('account-identities-empty-add');
    expect(open).toHaveBeenCalled();
  });

  it('removes an identity the user says is not theirs once they confirm', async () => {
    const { click, open, closed, userService } = await render();
    await click('account-identities-not-me-gitlab');

    expect(open).toHaveBeenCalledWith(AccountRemoveIdentityDialogComponent, expect.objectContaining({ role: 'alertdialog' }));
    closed.next(true);
    expect(userService.rejectIdentity).toHaveBeenCalledWith('gitlab', 'gitlab', undefined, undefined);
    expect(userService.refreshUserIdentities).toHaveBeenCalled();
  });

  it('reloads the identities after a verification', async () => {
    const { click, closed, userService } = await render();
    await click('account-identities-verify-gitlab');
    closed.next(true);

    expect(userService.refreshUserIdentities).toHaveBeenCalled();
  });
});
