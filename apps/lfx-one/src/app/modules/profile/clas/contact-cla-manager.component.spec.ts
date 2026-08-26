// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { CLA_MANAGER_MESSAGE_MAX_LENGTH } from '@lfx-one/shared/constants';
import type { ClaManager, ClaManagerList, ClaManagerRequestMode, ClaManagerRequestResult, ContactClaManagerDialogData } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyClasService } from '@services/my-clas.service';

import { ContactClaManagerComponent } from './contact-cla-manager.component';

const SIG = '3fee6d72-0c80-4145-99c2-fb382b3a93fb';
const JANE: ClaManager = { lfUsername: 'jdoe', name: 'Jane Doe' };
const ALEX: ClaManager = { lfUsername: 'akim', name: 'Alex Kim' };

describe('ContactClaManagerComponent', () => {
  let fixture: ComponentFixture<ContactClaManagerComponent>;
  let close: ReturnType<typeof vi.fn>;
  let getClaManagers: ReturnType<typeof vi.fn>;
  let createClaManagerRequest: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;

  async function setup(
    mode: ClaManagerRequestMode,
    list: ClaManagerList | 'error' = { signatureId: SIG, managers: [JANE, ALEX], resultCount: 2 }
  ): Promise<void> {
    TestBed.resetTestingModule();
    close = vi.fn();
    add = vi.fn();
    getClaManagers = vi.fn(() => (list === 'error' ? throwError(() => new Error('boom')) : of(list)));
    createClaManagerRequest = vi.fn(() =>
      of<ClaManagerRequestResult>({
        requestId: 'r-1',
        signatureId: SIG,
        requestType: mode,
        status: 'sent',
        recipients: [JANE.lfUsername],
      })
    );

    const data: ContactClaManagerDialogData = { signatureId: SIG, projectName: 'CNCF', mode };

    TestBed.configureTestingModule({
      imports: [ContactClaManagerComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: MessageService, useValue: { add } },
        { provide: MyClasService, useValue: { getClaManagers, createClaManagerRequest } },
      ],
    });

    fixture = TestBed.createComponent(ContactClaManagerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function send(): void {
    (fixture.componentInstance as unknown as { onSend: () => void }).onSend();
  }

  function uncheck(lfUsername: string): void {
    (fixture.componentInstance as any).managerForm.get(lfUsername)?.setValue(false);
    fixture.detectChanges();
  }

  function typeMessage(value: string): void {
    (fixture.componentInstance as any).messageControl.setValue(value);
    fixture.detectChanges();
  }

  function sendEnabled(): boolean {
    return (fixture.componentInstance as unknown as { canSend: () => boolean }).canSend();
  }

  beforeEach(async () => {
    await setup('approval');
  });

  it('shows v17 approval copy naming the project', () => {
    expect(query('contact-cla-manager-hint')?.textContent).toContain('re-approve your ECLA for CNCF');
  });

  it('leaves the message optional for approval, so it carries no aria-required', () => {
    expect(fixture.nativeElement.querySelector('textarea')?.getAttribute('aria-required')).toBeNull();
  });

  it('checks every manager by default', () => {
    expect(query('contact-cla-manager-jdoe')).not.toBeNull();
    expect((fixture.componentInstance as any).managerForm.get('jdoe')?.value).toBe(true);
    expect((fixture.componentInstance as any).managerForm.get('akim')?.value).toBe(true);
  });

  it('posts approval for the checked LF usernames on Send', async () => {
    send();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(createClaManagerRequest).toHaveBeenCalledWith(SIG, {
      requestType: 'approval',
      recipients: expect.arrayContaining(['jdoe', 'akim']),
    });
    expect(close).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Request sent' }));
  });

  it('disables Send when no manager is checked', async () => {
    uncheck('jdoe');
    uncheck('akim');

    send();
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });

  it('posts only the remaining checked manager after one is unchecked', async () => {
    uncheck('akim');
    send();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(createClaManagerRequest).toHaveBeenCalledWith(SIG, {
      requestType: 'approval',
      recipients: ['jdoe'],
    });
  });

  it('posts removal when opened in removal mode', async () => {
    await setup('removal');
    expect(query('contact-cla-manager-hint')?.textContent).toContain('invalidate it on your behalf');

    send();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(createClaManagerRequest).toHaveBeenCalledWith(SIG, expect.objectContaining({ requestType: 'removal' }));
  });

  it('leaves the message optional for approval and removal', async () => {
    expect(sendEnabled()).toBe(true);

    await setup('removal');
    expect(sendEnabled()).toBe(true);
  });

  it('reports a recorded approval/removal as a request, not a message', async () => {
    createClaManagerRequest.mockReturnValue(
      of<ClaManagerRequestResult>({ requestId: 'r-1', signatureId: SIG, requestType: 'approval', status: 'recorded', recipients: ['jdoe'] })
    );

    send();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Request recorded' }));
  });

  describe('contact mode', () => {
    beforeEach(async () => {
      await setup('contact');
    });

    it('shows contact copy and marks the message required', () => {
      expect(query('contact-cla-manager-hint')?.textContent).toContain('Send a message to the CLA manager(s) for CNCF');
      expect((fixture.componentInstance as unknown as { messageRequired: boolean }).messageRequired).toBe(true);
      // The asterisk is decorative, so assistive tech only learns the field is mandatory from this.
      expect(fixture.nativeElement.querySelector('textarea')?.getAttribute('aria-required')).toBe('true');
    });

    it('posts requestType contact with the message and the checked LF usernames', async () => {
      typeMessage('  who owns our approved list?  ');
      send();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(createClaManagerRequest).toHaveBeenCalledWith(SIG, {
        requestType: 'contact',
        recipients: expect.arrayContaining(['jdoe', 'akim']),
        message: 'who owns our approved list?',
      });
      expect(close).toHaveBeenCalled();
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Message sent' }));
    });

    it('reports a recorded contact as a message, not a request', async () => {
      createClaManagerRequest.mockReturnValue(
        of<ClaManagerRequestResult>({ requestId: 'r-1', signatureId: SIG, requestType: 'contact', status: 'recorded', recipients: ['jdoe'] })
      );
      typeMessage('hello');
      send();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Message recorded', severity: 'info' }));
    });

    it('keeps Send disabled and posts nothing while the message is blank', () => {
      expect(sendEnabled()).toBe(false);

      send();
      expect(createClaManagerRequest).not.toHaveBeenCalled();
    });

    // Opening to a red "required" line would scold the contributor for not having started.
    it('withholds the required error until the field has been edited', () => {
      expect(query('contact-cla-manager-message-error')).toBeNull();
      expect(query('contact-cla-manager-message-counter')?.textContent).toContain(`0/${CLA_MANAGER_MESSAGE_MAX_LENGTH}`);
    });

    it('keeps Send disabled for a whitespace-only message', () => {
      typeMessage('   \n\t ');

      expect(sendEnabled()).toBe(false);
      expect(query('contact-cla-manager-message-error')?.textContent).toContain('A message is required.');

      send();
      expect(createClaManagerRequest).not.toHaveBeenCalled();
    });

    it('enables Send once a non-blank message is typed', () => {
      typeMessage('please add me back');

      expect(sendEnabled()).toBe(true);
      expect(query('contact-cla-manager-message-error')).toBeNull();
    });

    it('accepts a message exactly at the cap', () => {
      typeMessage('x'.repeat(CLA_MANAGER_MESSAGE_MAX_LENGTH));

      expect(sendEnabled()).toBe(true);
    });

    it('blocks Send one code point over the cap and says so', () => {
      typeMessage('x'.repeat(CLA_MANAGER_MESSAGE_MAX_LENGTH + 1));

      expect(sendEnabled()).toBe(false);
      expect(query('contact-cla-manager-message-error')?.textContent).toContain(`${CLA_MANAGER_MESSAGE_MAX_LENGTH} characters or fewer`);

      send();
      expect(createClaManagerRequest).not.toHaveBeenCalled();
    });

    // Emoji are two UTF-16 units each, so a UTF-16 cap would reject this at roughly half the
    // producer's real rune allowance.
    it('counts an emoji-only message by code point, not UTF-16 unit', () => {
      typeMessage('🙂'.repeat(CLA_MANAGER_MESSAGE_MAX_LENGTH));

      expect(sendEnabled()).toBe(true);
    });

    it('still requires at least one recipient', () => {
      typeMessage('please add me back');
      uncheck('jdoe');
      uncheck('akim');

      expect(sendEnabled()).toBe(false);
      send();
      expect(createClaManagerRequest).not.toHaveBeenCalled();
    });

    it('surfaces the shared inline failure copy when the POST fails', async () => {
      createClaManagerRequest.mockReturnValue(throwError(() => new Error('boom')));
      typeMessage('hello');
      send();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain("Couldn't send the request. Try again.");
      expect(close).not.toHaveBeenCalled();
    });
  });

  it('caps the message for approval too, without requiring one', async () => {
    typeMessage('x'.repeat(CLA_MANAGER_MESSAGE_MAX_LENGTH + 1));
    expect(sendEnabled()).toBe(false);

    typeMessage('');
    expect(sendEnabled()).toBe(true);
  });

  it('shows support copy and no Send when no managers resolve', async () => {
    await setup('removal', { signatureId: SIG, managers: [], resultCount: 0 });

    expect(query('contact-cla-manager-empty')?.textContent).toContain('No CLA manager is currently reachable');
    expect(query('contact-cla-manager-send')).toBeNull();
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });

  it('hides Send when the manager list fails to load', async () => {
    await setup('approval', 'error');

    expect(query('contact-cla-manager-send')).toBeNull();
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });
});
