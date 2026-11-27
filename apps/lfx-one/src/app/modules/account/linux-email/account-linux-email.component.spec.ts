// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PENDING_LINUX_FORWARD_KEY } from '@lfx-one/shared/constants';
import { AccountPageForm, EnrichedIdentity, LinuxAliasData } from '@lfx-one/shared/interfaces';
import { AccountUnsavedChangesService } from '@services/account-unsaved-changes.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { MessageService } from 'primeng/api';
import { EMPTY, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => sessionStorage.clear());

  function setup(alias: Partial<LinuxAliasData>, identities: EnrichedIdentity[] | Observable<EnrichedIdentity[]> = [WORK_EMAIL]) {
    const registered: { page?: AccountPageForm } = {};
    const leaveForAuthorization = vi.fn();
    const confirm = vi.fn(() => ({ closed: of(true) }));
    const userService = {
      impersonating: signal(false),
      identitiesRefresh$: EMPTY,
      getIdentities: vi.fn(() => (Array.isArray(identities) ? of(identities) : identities)),
      refreshUserIdentities: vi.fn(),
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
    const card = fixture.debugElement.query(By.directive(AccountLinuxEmailComponent)).componentInstance as AccountLinuxEmailComponent;
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

  it('keeps a forwarding choice across Flow C and picks it again, unsaved, on return', async () => {
    const { userService } = setup({});
    userService.updateLinuxForward.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'management_token_required', authorize_url: '#authorize' } }))
    );
    const card = await createCard();
    card.editForm.controls.forwardTo.setValue('ada@work.example');
    card.updateForward();
    expect(JSON.parse(sessionStorage.getItem(PENDING_LINUX_FORWARD_KEY) ?? '{}').forwardTo).toBe('ada@work.example');

    TestBed.resetTestingModule();
    const back = setup({});
    const returned = await createCard();
    expect(returned.editForm.controls.forwardTo.value).toBe('ada@work.example');
    expect(back.page().dirty()).toBe(true);
    expect(sessionStorage.getItem(PENDING_LINUX_FORWARD_KEY)).toBeNull();
  });

  it('drops the kept choice once the user picks another address before it can be restored', async () => {
    sessionStorage.setItem(PENDING_LINUX_FORWARD_KEY, JSON.stringify({ savedAt: Date.now(), forwardTo: 'ada@work.example' }));
    setup({});
    const fixture = TestBed.createComponent(StateLinuxEmailComponent);
    await fixture.whenStable();
    const card = fixture.componentInstance;
    card.editForm.controls.forwardTo.setValue('ada@example.com');
    card.editForm.controls.forwardTo.markAsDirty();

    fixture.componentRef.setInput('identities', [WORK_EMAIL]);
    await fixture.whenStable();
    expect(card.editForm.controls.forwardTo.value).toBe('ada@example.com');
  });

  it('has nothing to save, and saves nothing, while the alias reloads after a save', async () => {
    const { userService, page } = setup({});
    const card = await createCard();
    card.editForm.controls.forwardTo.setValue('ada@work.example');
    card.loading.set(true);
    TestBed.tick();

    expect(page().dirty()).toBe(false);
    page().save();
    expect(userService.updateLinuxForward).not.toHaveBeenCalled();
  });

  it('locks the forwarding select while a save and the refresh after it run', async () => {
    const { userService } = setup({});
    const saved = new Subject<object>();
    userService.updateLinuxForward.mockReturnValueOnce(saved);
    const card = await createCard();
    card.editForm.controls.forwardTo.setValue('ada@work.example');
    card.updateForward();
    TestBed.tick();
    expect(card.editForm.controls.forwardTo.disabled).toBe(true);

    saved.next({});
    saved.complete();
    TestBed.tick();
    expect(card.editForm.controls.forwardTo.enabled).toBe(true);
  });

  it('warns, with a retry, when the verified addresses fail to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { userService } = setup(
      {},
      throwError(() => new Error('down'))
    );
    const { query } = await renderPage();

    expect(query('account-linux-email-identities-error')).not.toBeNull();
    query('account-linux-email-identities-retry')?.querySelector('button')?.click();
    expect(userService.refreshUserIdentities).toHaveBeenCalled();
    error.mockRestore();
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
