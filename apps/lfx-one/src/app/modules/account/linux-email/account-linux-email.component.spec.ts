// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AccountPageForm, EnrichedIdentity, LinuxAliasData } from '@lfx-one/shared/interfaces';
import { AccountUnsavedChangesService } from '@services/account-unsaved-changes.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { MessageService } from 'primeng/api';
import { EMPTY, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountLinuxEmailPageComponent } from './account-linux-email-page.component';
import { AccountLinuxEmailComponent } from './account-linux-email.component';

const BASE: LinuxAliasData = {
  state: 'claimed',
  domain: 'alias.example',
  alias: 'ada',
  email: 'ada@alias.example',
  forwardTo: 'ada@example.com',
  primaryEmail: 'ada@example.com',
};
const WORK_EMAIL = { type: 'email', value: 'ada@work.example', displayState: 'verified' } as EnrichedIdentity;

/** State-only card: no template, so these tests cost no render. */
@Component({ selector: 'lfx-test-account-linux-email', template: '' })
class StateLinuxEmailComponent extends AccountLinuxEmailComponent {}

describe('Account & Settings › Linux.com email', () => {
  function setup(alias: Partial<LinuxAliasData>, identities: EnrichedIdentity[] = [WORK_EMAIL]) {
    const registered: { page?: AccountPageForm } = {};
    const leaveForAuthorization = vi.fn();
    const confirm = vi.fn(() => ({ closed: of(true) }));
    const userService = {
      impersonating: signal(false),
      identitiesRefresh$: EMPTY,
      getIdentities: vi.fn(() => of(identities)),
      getLinuxAlias: vi.fn(() => of({ ...BASE, ...alias })),
      claimLinuxAlias: vi.fn(() => of({})),
      updateLinuxForward: vi.fn(() => of({})),
    };
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: UserService, useValue: userService },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: UiModalService, useValue: { open: confirm } },
        { provide: AccountUnsavedChangesService, useValue: { register: (page: AccountPageForm) => (registered.page = page), leaveForAuthorization } },
      ],
    });
    return { userService, confirm, leaveForAuthorization, page: () => registered.page as AccountPageForm };
  }

  async function renderPage() {
    const fixture = TestBed.createComponent(AccountLinuxEmailPageComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const card = fixture.debugElement.children[0].componentInstance as AccountLinuxEmailComponent;
    return { fixture, card, query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null };
  }

  async function createCard() {
    const fixture = TestBed.createComponent(StateLinuxEmailComponent);
    fixture.componentRef.setInput('identities', [WORK_EMAIL]);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  it('offers the add-on when it has not been bought', async () => {
    setup({ state: 'not_purchased', alias: null, email: null, forwardTo: null });
    const { query } = await renderPage();

    expect(query('account-linux-email-empty')?.textContent).toContain('Get your own Linux.com email');
    expect(query('account-linux-email-purchase')?.textContent?.trim()).toBe('Purchase email');
    expect(query('account-linux-email-active')).toBeNull();
  });

  it('asks before claiming an alias, then claims it with the chosen forwarding address', async () => {
    const { userService, confirm } = setup({ state: 'purchased_unclaimed', alias: null, email: null, forwardTo: null });
    const { fixture, card, query } = await renderPage();
    expect(query('account-linux-email-claim')?.textContent).toContain('Your add-on is active.');

    card.claimForm.setValue({ alias: 'Ada.Lovelace', forwardTo: 'ada@work.example' });
    await fixture.whenStable();
    query('account-linux-email-claim-button')?.querySelector('button')?.click();

    expect(confirm).toHaveBeenCalled();
    expect(card['pendingClaim']()).toEqual({ address: 'ada.lovelace@alias.example', forwardTo: 'ada@work.example' });
    expect(userService.claimLinuxAlias).toHaveBeenCalledWith({ alias: 'ada.lovelace', forwardTo: 'ada@work.example' });
  });

  it('says so when there is no verified address to forward to', async () => {
    setup({ state: 'purchased_unclaimed', alias: null, email: null, forwardTo: null, primaryEmail: null }, []);
    const { query } = await renderPage();

    expect(query('account-linux-email-no-forward')?.textContent).toContain('You don’t have a verified email address to forward to yet.');
    expect(query('account-linux-email-claim-forward')).toBeNull();
  });

  it('shows a claimed alias as active, with its address read-only', async () => {
    setup({});
    const { query } = await renderPage();

    expect(query('account-linux-email-active')?.textContent?.trim()).toBe('Active');
    expect((query('account-linux-email-address')?.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });

  it('saves a new forwarding address through the save bar, and reverts it', async () => {
    const { userService, page } = setup({});
    const card = await createCard();
    expect(page().dirty()).toBe(false);

    card.editForm.controls.forwardTo.setValue('ada@work.example');
    expect(page().dirty()).toBe(true);

    page().revert();
    expect(card.editForm.controls.forwardTo.value).toBe('ada@example.com');
    expect(page().dirty()).toBe(false);

    card.editForm.controls.forwardTo.setValue('ada@work.example');
    page().save();
    expect(userService.updateLinuxForward).toHaveBeenCalledWith('ada@work.example');
  });

  it('leaves for Flow C without the leave prompt when a forwarding save needs it', async () => {
    const { userService, page, leaveForAuthorization } = setup({});
    userService.updateLinuxForward.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'management_token_required', authorize_url: '#authorize' } }))
    );
    const card = await createCard();
    card.editForm.controls.forwardTo.setValue('ada@work.example');
    page().save();

    expect(leaveForAuthorization).toHaveBeenCalledWith('#authorize');
  });

  it('has nothing to save while the forwarding address cannot be read', async () => {
    const { page } = setup({ forwardTo: null, forwardAuthRequired: true });
    const card = await createCard();
    card.editForm.controls.forwardTo.setValue('ada@work.example');

    expect(page().dirty()).toBe(false);
  });

  it('offers a retry when the service is down', async () => {
    const { userService } = setup({ state: 'service_unavailable' });
    const { query } = await renderPage();
    query('account-linux-email-retry')?.querySelector('button')?.click();

    expect(userService.getLinuxAlias).toHaveBeenCalledTimes(2);
  });
});
