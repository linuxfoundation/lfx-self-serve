// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { VOTE_SEND_BALLOTS_COOLDOWN_MS } from '@lfx-one/shared/constants';
import { VoteService } from '@services/vote.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteSendBallotsComponent } from './vote-send-ballots.component';

// Synthetic fixtures only.
const recipients = (n: number) => Array.from({ length: n }, (_, i) => ({ uid: `r-${i}` }));

describe('VoteSendBallotsComponent (#4363)', () => {
  let fixture: ComponentFixture<VoteSendBallotsComponent>;
  let getReminderRecipients: ReturnType<typeof vi.fn>;
  let sendBallots: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let confirmation: ConfirmationService;

  const el = () => fixture.nativeElement as HTMLElement;
  const button = () => el().querySelector('[data-testid="vote-send-ballots-button"] button') as HTMLButtonElement;
  const success = () => el().querySelector('[data-testid="vote-send-ballots-success"]');

  /** Clicks the button and captures the confirmation, returning it so a test can accept or reject it. */
  function clickAndCapture() {
    const confirmSpy = vi.spyOn(confirmation, 'confirm');
    button().click();
    fixture.detectChanges();
    return confirmSpy.mock.calls[0]?.[0];
  }

  beforeEach(() => {
    vi.useFakeTimers();
    getReminderRecipients = vi.fn(() => of(recipients(3)));
    sendBallots = vi.fn(() => of({ sent: 3, skipped: 0 }));
    add = vi.fn();
    TestBed.configureTestingModule({
      imports: [VoteSendBallotsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: VoteService, useValue: { getReminderRecipients, sendBallots } },
        { provide: MessageService, useValue: { add } },
      ],
    });
    fixture = TestBed.createComponent(VoteSendBallotsComponent);
    fixture.componentRef.setInput('voteUid', 'v-1');
    fixture.detectChanges();
    confirmation = fixture.debugElement.injector.get(ConfirmationService);
  });

  afterEach(() => vi.useRealTimers());

  it('renders the action enabled with no success line', () => {
    expect(button().textContent).toContain('Send ballots now');
    expect(button().disabled).toBe(false);
    expect(success()).toBeNull();
  });

  it('asks for confirmation naming the number of members who have not voted, and sends nothing yet', () => {
    const confirmation = clickAndCapture();

    expect(confirmation?.message).toBe("Email a personal ballot link to the 3 members who haven't voted?");
    expect(confirmation?.acceptLabel).toBe('Send');
    expect(confirmation?.rejectLabel).toBe('Cancel');
    expect(sendBallots).not.toHaveBeenCalled();
  });

  it('uses the singular for one member', () => {
    getReminderRecipients.mockReturnValue(of(recipients(1)));

    expect(clickAndCapture()?.message).toBe("Email a personal ballot link to the 1 member who hasn't voted?");
  });

  it('does not send when the confirmation is cancelled', () => {
    clickAndCapture();

    expect(sendBallots).not.toHaveBeenCalled();
    expect(success()).toBeNull();
  });

  it('ignores Send if the vote changed while the dialog was open (#4691)', () => {
    const captured = clickAndCapture();

    fixture.componentRef.setInput('voteUid', 'v-2');
    fixture.detectChanges();
    captured?.accept?.();

    expect(sendBallots).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('opens no dialog if the vote changed before the voter list answered (#4691)', () => {
    const answer = new Subject<{ uid: string }[]>();
    getReminderRecipients.mockReturnValue(answer);
    const confirmSpy = vi.spyOn(confirmation, 'confirm');
    button().click();

    fixture.componentRef.setInput('voteUid', 'v-2');
    fixture.detectChanges();
    answer.next(recipients(3));

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('is confirming while the dialog is up and a tick after it hides, so the parent leaves Esc to it (#4691)', async () => {
    expect(fixture.componentInstance.confirming()).toBe(false);

    clickAndCapture();
    expect(fixture.componentInstance.confirming()).toBe(true);

    (fixture.componentInstance as unknown as { onConfirmHidden: () => void }).onConfirmHidden();
    expect(fixture.componentInstance.confirming()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.componentInstance.confirming()).toBe(false);
  });

  it('returns focus to the Send ballots button after Cancel, though the button disables while the voter list loads (#4691)', async () => {
    const answer = new Subject<{ uid: string }[]>();
    getReminderRecipients.mockReturnValue(answer);
    const confirmSpy = vi.spyOn(confirmation, 'confirm');
    button().focus();
    button().click();
    fixture.detectChanges();
    button().blur();
    answer.next(recipients(3));
    answer.complete();
    fixture.detectChanges();
    expect(confirmSpy).toHaveBeenCalledOnce();

    (fixture.componentInstance as unknown as { onConfirmHidden: () => void }).onConfirmHidden();
    await vi.advanceTimersByTimeAsync(1);

    expect(document.activeElement).toBe(button());
  });

  it('abandons a pending voter-list request: no dialog opens when the answer arrives and the button is usable again (#4691)', () => {
    const answer = new Subject<{ uid: string }[]>();
    getReminderRecipients.mockReturnValue(answer);
    const confirmSpy = vi.spyOn(confirmation, 'confirm');
    button().click();
    fixture.detectChanges();
    expect(button().disabled).toBe(true);

    fixture.componentInstance.abandon();
    fixture.detectChanges();
    answer.next(recipients(3));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });

  it('opens no dialog when the parent has another one open by the time the answer arrives (#4691)', () => {
    const answer = new Subject<{ uid: string }[]>();
    getReminderRecipients.mockReturnValue(answer);
    const confirmSpy = vi.spyOn(confirmation, 'confirm');
    button().click();

    fixture.componentRef.setInput('blocked', true);
    fixture.detectChanges();
    answer.next(recipients(3));

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('toasts only for the race: the list was non-empty at load and empty when clicked', () => {
    getReminderRecipients.mockReturnValue(of([]));
    const confirmSpy = vi.spyOn(confirmation, 'confirm');
    button().click();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info' }));
  });

  it('sends on Send, shows the count and time, and disables the action for the cooldown', () => {
    vi.setSystemTime(new Date(2026, 9, 28, 14, 5));
    clickAndCapture()?.accept?.();
    fixture.detectChanges();

    expect(sendBallots).toHaveBeenCalledExactlyOnceWith('v-1');
    expect(success()?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Ballots sent to 3 members · 14:05');
    expect(button().disabled).toBe(true);

    vi.advanceTimersByTime(VOTE_SEND_BALLOTS_COOLDOWN_MS - 1);
    fixture.detectChanges();
    expect(button().disabled).toBe(true);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
  });

  it('uses a two-minute cooldown', () => {
    expect(VOTE_SEND_BALLOTS_COOLDOWN_MS).toBe(120_000);
  });

  it('ignores a click during the cooldown', () => {
    clickAndCapture()?.accept?.();
    fixture.detectChanges();
    getReminderRecipients.mockClear();
    (fixture.componentInstance as unknown as { onClick: () => void }).onClick();

    expect(getReminderRecipients).not.toHaveBeenCalled();
  });

  it('warns about skipped members on a partial send but still shows the sent line', () => {
    sendBallots.mockReturnValue(of({ sent: 2, skipped: 1 }));
    clickAndCapture()?.accept?.();
    fixture.detectChanges();

    expect(success()?.textContent).toContain('Ballots sent to 2 members');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
  });

  it.each([
    ['a timeout', new Error('timeout')],
    ['a 503', new HttpErrorResponse({ status: 503 })],
    ['a 500', new HttpErrorResponse({ status: 500 })],
  ])('warns that delivery is unconfirmed, not "try again", after %s, since the batch may already be queued', (_label, error) => {
    sendBallots.mockReturnValue(throwError(() => error));
    clickAndCapture()?.accept?.();
    fixture.detectChanges();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Ballot delivery unconfirmed' }));
    expect(add.mock.calls[0][0].detail).toContain('duplicate emails');
    expect(success()).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it.each([400, 403, 409, 429])('shows a plain error after a clear %s rejection', (status) => {
    sendBallots.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
    clickAndCapture()?.accept?.();
    fixture.detectChanges();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Unable to send ballots' }));
    expect(add.mock.calls[0][0].detail).not.toContain('duplicate');
    expect(success()).toBeNull();
    expect(button().disabled).toBe(false);
  });

  describe('voter list known to be empty (#4740)', () => {
    beforeEach(() => {
      fixture.destroy();
      getReminderRecipients.mockReset();
      getReminderRecipients.mockReturnValue(of([]));
      fixture = TestBed.createComponent(VoteSendBallotsComponent);
      fixture.componentRef.setInput('voteUid', 'v-1');
      fixture.detectChanges();
      confirmation = fixture.debugElement.injector.get(ConfirmationService);
    });

    it('disables the button and says why, without a toast or a second read', () => {
      expect(getReminderRecipients).toHaveBeenCalledTimes(1);
      expect(button().disabled).toBe(true);
      expect(el().textContent).toContain('Everyone has voted');

      button().click();
      expect(getReminderRecipients).toHaveBeenCalledTimes(1);
      expect(add).not.toHaveBeenCalled();
    });

    it('re-reads the list when the vote changes and enables the button for a vote with voters left', () => {
      getReminderRecipients.mockReturnValue(of(recipients(2)));
      fixture.componentRef.setInput('voteUid', 'v-2');
      fixture.detectChanges();

      expect(getReminderRecipients).toHaveBeenLastCalledWith('v-2');
      expect(button().disabled).toBe(false);
    });
  });

  it('keeps the button disabled when the prefetch answers after a click found nobody left (#4744)', () => {
    fixture.destroy();
    const prefetch = new Subject<{ uid: string }[]>();
    getReminderRecipients.mockReset();
    getReminderRecipients.mockReturnValueOnce(prefetch).mockReturnValue(of([]));
    fixture = TestBed.createComponent(VoteSendBallotsComponent);
    fixture.componentRef.setInput('voteUid', 'v-1');
    fixture.detectChanges();

    button().click();
    fixture.detectChanges();
    expect(button().disabled).toBe(true);

    prefetch.next(recipients(3));
    prefetch.complete();
    fixture.detectChanges();

    expect(button().disabled).toBe(true);
  });

  it('leaves the button enabled when the list cannot be read up front', () => {
    fixture.destroy();
    getReminderRecipients.mockReturnValue(throwError(() => new Error('query down')));
    fixture = TestBed.createComponent(VoteSendBallotsComponent);
    fixture.componentRef.setInput('voteUid', 'v-1');
    fixture.detectChanges();

    expect(button().disabled).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  describe('voter list fails on click (#4740)', () => {
    it('clears loading, re-enables the button, restores focus, toasts and opens no dialog', () => {
      const answer = new Subject<{ uid: string }[]>();
      getReminderRecipients.mockReturnValue(answer);
      const confirmSpy = vi.spyOn(confirmation, 'confirm');
      button().focus();
      button().click();
      fixture.detectChanges();
      expect(button().disabled).toBe(true);
      // A disabled button gives up focus in a real browser; jsdom keeps it, so release it by hand.
      button().blur();

      answer.error(new Error('query down'));
      fixture.detectChanges();

      expect(button().disabled).toBe(false);
      expect(el().querySelector('[data-testid="vote-send-ballots-button"] .p-button-loading-icon, .pi-spinner')).toBeNull();
      expect(document.activeElement).toBe(button());
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: "Couldn't load the voter list. Try again." }));
      expect(confirmSpy).not.toHaveBeenCalled();
    });
  });

  it('keeps the action enabled with no success line after a failed send', () => {
    sendBallots.mockReturnValue(throwError(() => new Error('upstream down')));
    clickAndCapture()?.accept?.();
    fixture.detectChanges();

    expect(success()).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it('toasts when the non-responder count cannot be read, without opening the dialog', () => {
    getReminderRecipients.mockReturnValue(throwError(() => new Error('query down')));
    const confirmSpy = vi.spyOn(confirmation, 'confirm');
    button().click();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});
