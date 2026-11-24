// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EMAIL_RESEND_SUPPORT_THRESHOLD } from '@lfx-one/shared/constants';
import { EmailCodeVerificationService } from '@services/email-code-verification.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { MessageService } from 'primeng/api';
import { describe, expect, it, vi } from 'vitest';

import { AccountEmailCodeStepComponent } from './account-email-code-step.component';

describe('AccountEmailCodeStepComponent', () => {
  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        EmailCodeVerificationService,
        { provide: UserService, useValue: {} },
        { provide: UiToastService, useValue: { show: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountEmailCodeStepComponent);
    fixture.componentRef.setInput('email', 'ada@example.com');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    return { fixture, query, verification: TestBed.inject(EmailCodeVerificationService) };
  }

  async function typeInto(fixture: { whenStable: () => Promise<unknown> }, input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('drops a letter typed after five digits from the field as well as the code', async () => {
    const { fixture, query, verification } = await render();
    const input = query('account-email-code-input')?.querySelector('input') as HTMLInputElement;
    await typeInto(fixture, input, '12345');
    await typeInto(fixture, input, '12345a');

    expect(verification.code()).toBe('12345');
    expect(input.value).toBe('12345');

    await typeInto(fixture, input, '123456');
    expect(verification.code()).toBe('123456');
  });

  it('takes a pasted code with a space in it', async () => {
    const { fixture, query, verification } = await render();
    const input = query('account-email-code-input')?.querySelector('input') as HTMLInputElement;
    await typeInto(fixture, input, '123 456');

    expect(input.maxLength).toBe(-1);
    expect(verification.code()).toBe('123456');
    expect(input.value).toBe('123456');
  });

  it('offers support for an address already linked to another account', async () => {
    const { fixture, query, verification } = await render();
    verification.error.set('This email is already linked to another LFX account');
    await fixture.whenStable();

    expect(query('account-email-code-error')?.textContent).toContain('already linked to an LFX account');
    expect(query('account-email-code-linked-support')).not.toBeNull();
  });

  it('gives way to support once the resends run out', async () => {
    const { fixture, query, verification } = await render();
    expect(query('account-email-code-hint')).not.toBeNull();

    verification.resendCount.set(EMAIL_RESEND_SUPPORT_THRESHOLD);
    await fixture.whenStable();

    expect(query('account-email-code-hint')).toBeNull();
    expect(query('account-email-code-resend-support')).not.toBeNull();
  });
});
