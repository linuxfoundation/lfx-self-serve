// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AccountPageForm, EnrichedIdentity, LinuxAliasData } from '@lfx-one/shared/interfaces';
import { AccountUnsavedChangesService } from '@services/account-unsaved-changes.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { MessageService } from 'primeng/api';
import { EMPTY, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountLinuxEmailPageComponent } from './account-linux-email-page.component';

const BASE: LinuxAliasData = {
  state: 'claimed',
  domain: 'linux.com',
  alias: 'ada',
  email: 'ada@linux.com',
  forwardTo: 'ada@example.com',
  primaryEmail: 'ada@example.com',
};
const WORK_EMAIL = { type: 'email', value: 'ada@work.example', displayState: 'verified' } as EnrichedIdentity;

describe('AccountLinuxEmailPageComponent', () => {
  async function render(alias: Partial<LinuxAliasData>) {
    let page: AccountPageForm | undefined;
    const confirm = vi.fn(() => ({ closed: of(true) }));
    const userService = {
      impersonating: signal(false),
      identitiesRefresh$: EMPTY,
      getIdentities: vi.fn(() => of([WORK_EMAIL])),
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
        { provide: AccountUnsavedChangesService, useValue: { register: (form: AccountPageForm) => (page = form) } },
      ],
    });
    const fixture = TestBed.createComponent(AccountLinuxEmailPageComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    return { fixture, query, userService, confirm, page: () => page as AccountPageForm };
  }

  it('offers the add-on when it has not been bought', async () => {
    const { query } = await render({ state: 'not_purchased', alias: null, email: null, forwardTo: null });

    expect(query('account-linux-email-empty')?.textContent).toContain('Get your own Linux.com email');
    expect(query('account-linux-email-purchase')?.textContent?.trim()).toBe('Purchase email');
    expect(query('account-linux-email-active')).toBeNull();
  });

  it('asks before claiming an alias, then claims it with the chosen forwarding address', async () => {
    const { fixture, query, userService, confirm } = await render({ state: 'purchased_unclaimed', alias: null, email: null, forwardTo: null });
    expect(query('account-linux-email-claim')?.textContent).toContain('Your add-on is active.');

    const component = fixture.debugElement.children[0].componentInstance;
    component.claimForm.setValue({ alias: 'Ada.Lovelace', forwardTo: 'ada@work.example' });
    await fixture.whenStable();
    query('account-linux-email-claim-button')?.querySelector('button')?.click();

    expect(confirm).toHaveBeenCalled();
    expect(component.pendingClaim()).toEqual({ address: 'ada.lovelace@linux.com', forwardTo: 'ada@work.example' });
    expect(userService.claimLinuxAlias).toHaveBeenCalledWith({ alias: 'ada.lovelace', forwardTo: 'ada@work.example' });
  });

  it('shows the claimed alias as active and saves a new forwarding address through the save bar', async () => {
    const { fixture, query, userService, page } = await render({});
    expect(query('account-linux-email-active')?.textContent?.trim()).toBe('Active');
    expect(page().dirty()).toBe(false);

    const component = fixture.debugElement.children[0].componentInstance;
    component.editForm.controls.forwardTo.setValue('ada@work.example');
    expect(page().dirty()).toBe(true);

    page().revert();
    expect(component.editForm.controls.forwardTo.value).toBe('ada@example.com');
    expect(page().dirty()).toBe(false);

    component.editForm.controls.forwardTo.setValue('ada@work.example');
    page().save();
    expect(userService.updateLinuxForward).toHaveBeenCalledWith('ada@work.example');
  });

  it('has nothing to save while the forwarding address cannot be read', async () => {
    const { fixture, query, page } = await render({ forwardTo: null, forwardAuthRequired: true });
    const component = fixture.debugElement.children[0].componentInstance;
    component.editForm.controls.forwardTo.setValue('ada@work.example');

    expect(query('account-linux-email-reauth')).not.toBeNull();
    expect(page().dirty()).toBe(false);
  });

  it('offers a retry when the service is down', async () => {
    const { query, userService } = await render({ state: 'service_unavailable' });
    query('account-linux-email-retry')?.querySelector('button')?.click();

    expect(userService.getLinuxAlias).toHaveBeenCalledTimes(2);
  });
});
