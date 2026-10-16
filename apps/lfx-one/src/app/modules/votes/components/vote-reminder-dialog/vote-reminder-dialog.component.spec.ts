// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VOTE_REMINDER_INACTIVE, VOTE_REMINDER_PRECHECK_FAILED, VOTE_REMINDER_SELECTION_STALE } from '@lfx-one/shared/constants';
import { VoteReminderRecipient } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoteReminderDialogComponent } from './vote-reminder-dialog.component';

const RECIPIENTS: VoteReminderRecipient[] = [
  { uid: 'r-1', user_name: 'Avery Example', user_email: 'avery@acme-motors.example', user_org_name: 'Acme Motors', user_voting_status: 'Voting Rep' },
  { uid: 'r-2', user_name: 'Blake Example', user_email: 'blake@beta-coastal.example', user_role: 'Chair' },
];

/**
 * Mounts the dialog over vote `vote-1`.
 * @returns the fixture, the component, and the spies used to inspect sends, toasts and close.
 */
async function mount(recipients: Observable<VoteReminderRecipient[]>, send: Observable<{ recipient_count: number }> = of({ recipient_count: 2 })) {
  TestBed.resetTestingModule();

  const getReminderRecipients = vi.fn().mockReturnValue(recipients);
  const sendReminders = vi.fn().mockReturnValue(send);
  const add = vi.fn();
  const close = vi.fn();
  const config = { data: { vote: { uid: 'vote-1' } }, closable: true };

  TestBed.configureTestingModule({
    imports: [VoteReminderDialogComponent],
    providers: [
      { provide: DynamicDialogRef, useValue: { close } },
      { provide: DynamicDialogConfig, useValue: config },
      { provide: VoteService, useValue: { getReminderRecipients, sendReminders } },
      { provide: MessageService, useValue: { add } },
    ],
  });

  const fixture = TestBed.createComponent(VoteReminderDialogComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, component: fixture.componentInstance, config, getReminderRecipients, sendReminders, add, close };
}

function byTestId(fixture: ComponentFixture<VoteReminderDialogComponent>, id: string): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
}

function sendButton(fixture: ComponentFixture<VoteReminderDialogComponent>): HTMLButtonElement {
  return byTestId(fixture, 'vote-reminder-dialog-send')!.querySelector('button')!;
}

function selected(component: VoteReminderDialogComponent): string[] {
  return [...component['selectedUids']()].sort();
}

describe('VoteReminderDialogComponent', () => {
  let current: ComponentFixture<VoteReminderDialogComponent> | undefined;
  afterEach(() => current?.destroy());

  it('loads the recipients for the vote and starts with every one selected', async () => {
    const { fixture, component, getReminderRecipients } = await mount(of(RECIPIENTS));
    current = fixture;

    expect(getReminderRecipients).toHaveBeenCalledWith('vote-1');
    expect(selected(component)).toEqual(['r-1', 'r-2']);
    expect(component['checkboxForm'].getRawValue()).toEqual({ 'r-1': true, 'r-2': true });
    expect(component['selectAllForm'].controls.all.value).toBe(true);
    expect(byTestId(fixture, 'vote-reminder-dialog-count')!.textContent).toContain('2 of 2 selected');
    expect(byTestId(fixture, 'vote-reminder-dialog-row-r-1')).not.toBeNull();
    expect(sendButton(fixture).disabled).toBe(false);
  });

  it('allows both horizontal and vertical scrolling within the recipient table height limit', async () => {
    const { fixture } = await mount(of(RECIPIENTS));
    current = fixture;
    const table = byTestId(fixture, 'vote-reminder-dialog-table')!;
    expect(table.classList.contains('overflow-auto')).toBe(true);
    expect(table.classList.contains('overflow-hidden')).toBe(false);
    expect(table.classList.contains('overflow-y-auto')).toBe(false);
    expect(table.classList.contains('max-h-80')).toBe(true);
  });

  it('layers the sticky header above the positioned recipient checkboxes', async () => {
    const { fixture } = await mount(of(RECIPIENTS));
    current = fixture;
    const header = byTestId(fixture, 'vote-reminder-dialog-table')!.querySelector('thead tr')!;

    expect(header.classList.contains('sticky')).toBe(true);
    expect(header.classList.contains('top-0')).toBe(true);
    expect(header.classList.contains('z-10')).toBe(true);
    expect(header.classList.contains('bg-gray-50')).toBe(true);
  });

  it('toggles one recipient and the select-all, keeping the checkboxes in sync', async () => {
    const { fixture, component } = await mount(of(RECIPIENTS));
    current = fixture;

    component['toggleRecipient']('r-1');
    expect(selected(component)).toEqual(['r-2']);
    expect(component['checkboxForm'].getRawValue()).toEqual({ 'r-1': false, 'r-2': true });
    expect(component['selectAllForm'].controls.all.value).toBe(false);

    component['toggleSelectAll']();
    expect(selected(component)).toEqual(['r-1', 'r-2']);
    expect(component['selectAllForm'].controls.all.value).toBe(true);

    component['toggleSelectAll']();
    expect(selected(component)).toEqual([]);
    expect(component['checkboxForm'].getRawValue()).toEqual({ 'r-1': false, 'r-2': false });
  });

  it('keeps the selection and checkboxes in sync when the checkbox inputs themselves are clicked', async () => {
    const { fixture, component } = await mount(of(RECIPIENTS));
    current = fixture;
    const input = (id: string): HTMLInputElement => fixture.nativeElement.querySelector(`#${id}`);

    input('vote-reminder-select-r-1').click();
    fixture.detectChanges();
    expect(selected(component)).toEqual(['r-2']);
    expect(component['checkboxForm'].getRawValue()).toEqual({ 'r-1': false, 'r-2': true });
    expect(component['selectAllForm'].controls.all.value).toBe(false);

    input('vote-reminder-select-all').click();
    fixture.detectChanges();
    expect(selected(component)).toEqual(['r-1', 'r-2']);
    expect(component['checkboxForm'].getRawValue()).toEqual({ 'r-1': true, 'r-2': true });
    expect(component['selectAllForm'].controls.all.value).toBe(true);
  });

  it('disables Send while nothing is selected', async () => {
    const { fixture, component, sendReminders } = await mount(of(RECIPIENTS));
    current = fixture;

    component['toggleSelectAll']();
    fixture.detectChanges();

    expect(sendButton(fixture).disabled).toBe(true);
    component['send']();
    expect(sendReminders).not.toHaveBeenCalled();
  });

  it('sends exactly the selected recipients, shows the success toast and closes', async () => {
    const { fixture, component, sendReminders, add, close } = await mount(of(RECIPIENTS), of({ recipient_count: 1 }));
    current = fixture;

    component['toggleRecipient']('r-2');
    component['send']();

    expect(sendReminders).toHaveBeenCalledWith('vote-1', ['r-1']);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: 'Reminder sent to 1 voter.' }));
    expect(close).toHaveBeenCalledWith(true);
    expect(component['sending']()).toBe(false);
  });

  it('keeps the dialog open and Cancel disabled while a send is in flight', async () => {
    const pending = new Subject<{ recipient_count: number }>();
    const { fixture, component, close } = await mount(of(RECIPIENTS), pending);
    current = fixture;
    const cancelButton = (): HTMLButtonElement => byTestId(fixture, 'vote-reminder-dialog-cancel')!.querySelector('button')!;

    component['send']();
    fixture.detectChanges();

    expect(cancelButton().disabled).toBe(true);
    component['cancel']();
    expect(close).not.toHaveBeenCalled();

    pending.next({ recipient_count: 2 });
    pending.complete();
    fixture.detectChanges();

    expect(close).toHaveBeenCalledWith(true);
    expect(cancelButton().disabled).toBe(false);
  });

  it('pluralizes the success toast', async () => {
    const { fixture, component, add } = await mount(of(RECIPIENTS), of({ recipient_count: 2 }));
    current = fixture;

    component['send']();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Reminder sent to 2 voters.' }));
  });

  it.each([
    [400, 'This vote is no longer active, or some recipients are no longer eligible. Refresh and try again.'],
    [403, "You don't have permission to send reminders for this vote."],
    [429, 'Too many reminders were sent just now. Please try again in a minute.'],
    [500, "We couldn't confirm whether reminders were sent. Retrying may send duplicate emails."],
  ])('maps a %s send failure to plain-language copy and keeps the dialog open', async (status, detail) => {
    const { fixture, component, add, close } = await mount(
      of(RECIPIENTS),
      throwError(() => new HttpErrorResponse({ status }))
    );
    current = fixture;

    component['send']();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail }));
    expect(close).not.toHaveBeenCalled();
    expect(component['sending']()).toBe(false);
    expect(selected(component)).toEqual(['r-1', 'r-2']);
  });

  it('locks the host header and Escape only while sending, restoring dismissal on failure', async () => {
    const pending = new Subject<{ recipient_count: number }>();
    const { fixture, component, config } = await mount(of(RECIPIENTS), pending);
    current = fixture;
    const escape = (): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      return event;
    };
    expect(config.closable).toBe(true);
    expect(escape().defaultPrevented).toBe(false);
    component['send']();
    // Escape protection reads the signal synchronously, even before the reactive header updates.
    expect(escape().defaultPrevented).toBe(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(config.closable).toBe(false);
    pending.error(new HttpErrorResponse({ status: 429 }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(config.closable).toBe(true);
    expect(escape().defaultPrevented).toBe(false);
  });

  it.each(['success', 'failure'])('keeps an initiated send subscribed after destruction and reports %s', async (outcome) => {
    const pending = new Subject<{ recipient_count: number }>();
    const { fixture, component, add, close } = await mount(of(RECIPIENTS), pending);
    component['send']();
    fixture.destroy();
    expect(pending.observed).toBe(true);
    if (outcome === 'success') {
      pending.next({ recipient_count: 2 });
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    } else {
      pending.error(new HttpErrorResponse({ status: 429 }));
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Too many reminders were sent just now. Please try again in a minute.' }));
    }
    expect(pending.observed).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it.each([404, 408, 500, 502, 503, 504])('allows retry without a duplicate warning for a marked %s pre-send failure', async (status) => {
    const { fixture, component, add, close } = await mount(
      of(RECIPIENTS),
      throwError(() => new HttpErrorResponse({ status, error: { code: VOTE_REMINDER_PRECHECK_FAILED } }))
    );
    current = fixture;
    component['send']();
    fixture.detectChanges();
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "Couldn't send reminder",
        detail: "We couldn't verify access or the voter list. No reminders were sent. Please try again.",
      })
    );
    expect(selected(component)).toEqual(['r-1', 'r-2']);
    expect(sendButton(fixture).disabled).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it.each([
    new HttpErrorResponse({ status: 0 }),
    new HttpErrorResponse({ status: 408 }),
    new HttpErrorResponse({ status: 502 }),
    new HttpErrorResponse({ status: 503 }),
    new HttpErrorResponse({ status: 503, error: { transport: true } }),
    new HttpErrorResponse({ status: 504 }),
  ])('warns about duplicates when the send outcome cannot be confirmed (%s)', async (error) => {
    const { fixture, component, add } = await mount(
      of(RECIPIENTS),
      throwError(() => error)
    );
    current = fixture;
    component['send']();
    fixture.detectChanges();
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Outcome unconfirmed',
        detail: "We couldn't confirm whether reminders were sent. Retrying may send duplicate emails.",
      })
    );
    expect(sendButton(fixture).disabled).toBe(false);
  });

  it('requires a recipient reload after a stale-selection rejection without claiming any sends', async () => {
    const { fixture, component, getReminderRecipients, add, close } = await mount(
      of(RECIPIENTS),
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: VOTE_REMINDER_SELECTION_STALE } }))
    );
    current = fixture;
    component['send']();
    fixture.detectChanges();
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "Couldn't send reminder", detail: expect.stringContaining('No reminders were sent.') })
    );
    expect(selected(component)).toEqual([]);
    expect(sendButton(fixture).disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();
    getReminderRecipients.mockReturnValue(of([RECIPIENTS[1]]));
    byTestId(fixture, 'vote-reminder-dialog-retry')!.querySelector('button')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(selected(component)).toEqual(['r-2']);
    expect(sendButton(fixture).disabled).toBe(false);
  });

  it('shows an inactive-vote state rather than everyone voted when loading a closed poll', async () => {
    const { fixture } = await mount(throwError(() => new HttpErrorResponse({ status: 409, error: { code: VOTE_REMINDER_INACTIVE } })));
    current = fixture;
    expect(byTestId(fixture, 'vote-reminder-dialog-inactive')!.textContent).toContain('This vote is no longer active.');
    expect(byTestId(fixture, 'vote-reminder-dialog-empty')).toBeNull();
    expect(byTestId(fixture, 'vote-reminder-dialog-retry')).toBeNull();
    expect(sendButton(fixture).disabled).toBe(true);
  });

  it('shows an inactive-vote state when the poll closes between loading and sending', async () => {
    const { fixture, component, add } = await mount(
      of(RECIPIENTS),
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: VOTE_REMINDER_INACTIVE } }))
    );
    current = fixture;
    component['send']();
    fixture.detectChanges();
    expect(byTestId(fixture, 'vote-reminder-dialog-inactive')).not.toBeNull();
    expect(sendButton(fixture).disabled).toBe(true);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "Couldn't send reminder", detail: 'This vote is no longer active. Reminders cannot be sent.' })
    );
  });

  it('shows the "Everyone has voted" empty state with Send disabled when no one is left to remind', async () => {
    const { fixture } = await mount(of([]));
    current = fixture;

    expect(byTestId(fixture, 'vote-reminder-dialog-empty')!.textContent).toContain('Everyone has voted.');
    expect(byTestId(fixture, 'vote-reminder-dialog-table')).toBeNull();
    expect(sendButton(fixture).disabled).toBe(true);
  });

  it('shows a retry state when loading fails, and retry reloads the recipients', async () => {
    const { fixture, getReminderRecipients } = await mount(throwError(() => new HttpErrorResponse({ status: 503 })));
    current = fixture;

    expect(byTestId(fixture, 'vote-reminder-dialog-error')!.textContent).toContain("We couldn't load the voter list. Please try again.");
    expect(sendButton(fixture).disabled).toBe(true);

    getReminderRecipients.mockReturnValue(of(RECIPIENTS));
    byTestId(fixture, 'vote-reminder-dialog-retry')!.querySelector('button')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getReminderRecipients).toHaveBeenCalledTimes(2);
    expect(byTestId(fixture, 'vote-reminder-dialog-error')).toBeNull();
    expect(byTestId(fixture, 'vote-reminder-dialog-table')).not.toBeNull();
  });

  it('explains a 403 load failure as a permission error', async () => {
    const { fixture } = await mount(throwError(() => new HttpErrorResponse({ status: 403 })));
    current = fixture;

    expect(byTestId(fixture, 'vote-reminder-dialog-error')!.textContent).toContain("You don't have permission to send reminders for this vote.");
  });
});
