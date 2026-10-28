// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { VOTE_SEND_BALLOTS_COOLDOWN_MS } from '@lfx-one/shared/constants';
import { VoteService } from '@services/vote.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
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

    expect(clickAndCapture()?.message).toBe("Email a personal ballot link to the 1 member who haven't voted?");
  });

  it('does not send when the confirmation is cancelled', () => {
    clickAndCapture();

    expect(sendBallots).not.toHaveBeenCalled();
    expect(success()).toBeNull();
  });

  it('skips the dialog and tells the writer when everyone has voted', () => {
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

  it('toasts on a failed send and leaves the action enabled with no success line', () => {
    sendBallots.mockReturnValue(throwError(() => new Error('upstream down')));
    clickAndCapture()?.accept?.();
    fixture.detectChanges();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Unable to send ballots' }));
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
