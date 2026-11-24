// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountAddIdentityDialogComponent } from './account-add-identity-dialog.component';

describe('AccountAddIdentityDialogComponent', () => {
  async function render() {
    const close = vi.fn();
    const userService = { sendEmailVerificationCode: vi.fn(() => of({ success: true })), verifyAndLinkEmail: vi.fn(() => of({ success: true })) };
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: DialogRef, useValue: { close } },
        { provide: UserService, useValue: userService },
        { provide: UiToastService, useValue: { show: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountAddIdentityDialogComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    const click = async (testId: string) => {
      (query(testId)?.querySelector('button') ?? query(testId))?.click();
      await fixture.whenStable();
    };
    const type = async (testId: string, value: string) => {
      const input = query(testId)?.querySelector('input') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    return { host, query, click, type, close, userService };
  }

  it('lists the providers to connect, with an email address to add', async () => {
    const { query } = await render();

    expect(query('account-add-identity-provider-github')?.textContent).toContain('Connect your GitHub account for code contributions');
    expect(query('account-add-identity-choose-github')?.textContent?.trim()).toBe('Connect');
    expect(query('account-add-identity-choose-email')?.textContent?.trim()).toBe('Add email');
    expect(query('account-add-identity-provider-lfid')).toBeNull();
  });

  it('adds an email: address, code, then closes once it is linked', async () => {
    const { query, click, type, close, userService } = await render();
    await click('account-add-identity-choose-email');
    await type('account-add-identity-email', 'ada@example.com');
    await click('account-add-identity-send');

    expect(userService.sendEmailVerificationCode).toHaveBeenCalledWith('ada@example.com');
    expect(query('account-email-code-instructions')?.textContent).toContain('ada@example.com');

    await type('account-email-code-input', '12a3456');
    await click('account-add-identity-verify');

    expect(userService.verifyAndLinkEmail).toHaveBeenCalledWith('ada@example.com', '123456');
    expect(close).toHaveBeenCalledWith(true);
  });

  it('goes back from the code to the address, and from the address to the providers', async () => {
    const { query, click, type } = await render();
    await click('account-add-identity-choose-email');
    await type('account-add-identity-email', 'ada@example.com');
    await click('account-add-identity-send');

    await click('account-add-identity-back');
    expect(query('account-add-identity-email')).not.toBeNull();

    await click('account-add-identity-back');
    expect(query('account-add-identity-providers')).not.toBeNull();
  });
});
