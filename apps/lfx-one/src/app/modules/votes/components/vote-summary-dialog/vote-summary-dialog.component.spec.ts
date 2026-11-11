// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VOTE_SUMMARY_NOT_ENDED, VOTE_SUMMARY_PRECHECK_FAILED, VOTE_SUMMARY_SEND_FAILED } from '@lfx-one/shared/constants';
import { SendVoteSummaryResponse, VoteSummaryPreviewResponse } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { VoteSummarySendService } from '@services/vote-summary-send.service';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { NEVER, Observable, of, Subject, throwError, TimeoutError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoteSummaryDialogComponent } from './vote-summary-dialog.component';

const AVERY = { uid: 'r-1', user_name: 'Avery Example', user_email: 'avery@acme-motors.example' };
const BLAKE = { uid: 'r-2', user_name: 'Blake Example', user_email: 'shared@beta-coastal.example' };
const CASEY = { uid: 'r-3', user_name: 'Casey Example', user_email: 'SHARED@beta-coastal.example' };
const DREW = { uid: 'r-4', user_name: 'Drew Example' };

const PREVIEW: VoteSummaryPreviewResponse = { ready: [AVERY, BLAKE], missing_email: [DREW], unique_email_count: 2, shared_email_voter_count: 0 };

const SENT: SendVoteSummaryResponse = {
  recipient_count: 1,
  failed_count: 1,
  skipped_count: 1,
  uncertain_count: 0,
  recipients: [
    { ...AVERY, outcome: 'sent' },
    { ...BLAKE, outcome: 'failed' },
    { ...DREW, outcome: 'skipped' },
  ],
};

/**
 * Mounts the dialog over vote `vote-1`.
 * @returns the fixture, the component, and the spies used to inspect reads, sends, toasts and close.
 */
async function mount(preview: Observable<VoteSummaryPreviewResponse>, send: Observable<SendVoteSummaryResponse> = of(SENT)) {
  TestBed.resetTestingModule();

  const getVoteSummaryPreview = vi.fn().mockReturnValue(preview);
  const sendVoteSummary = vi.fn().mockReturnValue(send);
  const add = vi.fn();
  const onClose = new Subject<unknown>();
  const close = vi.fn((result?: unknown) => onClose.next(result));
  const config = { data: { vote: { uid: 'vote-1', name: 'Spring Election' } }, closable: true };
  const user = signal<{ sub: string } | null>({ sub: 'synthetic-manager' });

  TestBed.configureTestingModule({
    imports: [VoteSummaryDialogComponent],
    providers: [
      { provide: DynamicDialogRef, useValue: { close, onClose: onClose.asObservable() } },
      { provide: DynamicDialogConfig, useValue: config },
      { provide: VoteService, useValue: { getVoteSummaryPreview, sendVoteSummary } },
      { provide: UserService, useValue: { user } },
      { provide: MessageService, useValue: { add } },
    ],
  });

  const fixture = TestBed.createComponent(VoteSummaryDialogComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, component: fixture.componentInstance, config, getVoteSummaryPreview, sendVoteSummary, add, close, user };
}

function byTestId(fixture: ComponentFixture<VoteSummaryDialogComponent>, id: string): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
}

function button(fixture: ComponentFixture<VoteSummaryDialogComponent>, id: string): HTMLButtonElement {
  return byTestId(fixture, id)!.querySelector('button')!;
}

async function render(fixture: ComponentFixture<VoteSummaryDialogComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

/** Review → confirm → Send now. */
async function sendNow(fixture: ComponentFixture<VoteSummaryDialogComponent>): Promise<void> {
  button(fixture, 'vote-summary-dialog-send').click();
  await render(fixture);
  button(fixture, 'vote-summary-dialog-send-now').click();
  await render(fixture);
}

describe('VoteSummaryDialogComponent', () => {
  let current: ComponentFixture<VoteSummaryDialogComponent> | undefined;
  afterEach(() => current?.destroy());

  it('disables Send while the recipients load', async () => {
    const { fixture } = await mount(NEVER);
    current = fixture;

    expect(byTestId(fixture, 'vote-summary-dialog-loading')).not.toBeNull();
    expect(button(fixture, 'vote-summary-dialog-send').disabled).toBe(true);
  });

  it('announces initial recipient loading in the persistent status region and clears it when ready', async () => {
    const pending = new Subject<VoteSummaryPreviewResponse>();
    const { fixture } = await mount(pending);
    current = fixture;
    const status = byTestId(fixture, 'vote-summary-dialog-send-status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.textContent).toContain('Loading recipients.');
    expect(status.textContent).toContain('Send is unavailable until the review is ready.');
    pending.next(PREVIEW);
    pending.complete();
    await render(fixture);
    expect(byTestId(fixture, 'vote-summary-dialog-send-status')).toBe(status);
    expect(status.textContent!.trim()).toBe('');
  });

  it('shows the vote name, the ready and missing-email lists, and the voter vs. address counts', async () => {
    const { fixture, getVoteSummaryPreview } = await mount(of(PREVIEW));
    current = fixture;

    expect(getVoteSummaryPreview).toHaveBeenCalledWith('vote-1');
    expect(byTestId(fixture, 'vote-summary-dialog-vote-name')!.textContent).toContain('Spring Election');
    expect(byTestId(fixture, 'vote-summary-dialog-overview')!.textContent).toContain('3 voters · 2 email addresses');
    expect(byTestId(fixture, 'vote-summary-dialog-overview')!.getAttribute('role')).toBe('status');
    expect(byTestId(fixture, 'vote-summary-dialog-ready')!.textContent).toContain('Ready to receive (2)');
    expect(byTestId(fixture, 'vote-summary-dialog-ready-r-1')!.textContent).toContain('avery@acme-motors.example');
    expect(byTestId(fixture, 'vote-summary-dialog-missing')!.textContent).toContain('No email address (1)');
    expect(byTestId(fixture, 'vote-summary-dialog-missing-r-4')!.textContent).toContain("Can't receive the summary");
    expect(byTestId(fixture, 'vote-summary-dialog-shared-note')).toBeNull();
    expect(button(fixture, 'vote-summary-dialog-send').disabled).toBe(false);
  });

  it('keeps each list scrollable within a viewport-aware height limit', async () => {
    const { fixture } = await mount(of(PREVIEW));
    current = fixture;

    for (const id of ['ready', 'missing']) {
      const list = byTestId(fixture, `vote-summary-dialog-${id}`)!.querySelector('ul')!;
      expect(list.classList.contains('overflow-auto')).toBe(true);
      expect(list.classList.contains('max-h-[min(32rem,calc(90dvh-14rem))]')).toBe(true);
      expect(list.tabIndex).toBe(0);
      expect(list.getAttribute('aria-labelledby')).toBe(`vote-summary-${id}-heading`);
      expect(list.classList.contains('focus-visible:outline-2')).toBe(true);
      list.focus();
      expect(document.activeElement).toBe(list);
    }
  });

  it('explains that voters sharing an address get one email', async () => {
    const { fixture } = await mount(of({ ready: [AVERY, BLAKE, CASEY], missing_email: [], unique_email_count: 2, shared_email_voter_count: 2 }));
    current = fixture;

    expect(byTestId(fixture, 'vote-summary-dialog-overview')!.textContent).toContain('3 voters · 2 email addresses');
    expect(byTestId(fixture, 'vote-summary-dialog-shared-note')!.textContent).toContain('Each address receives one summary.');
  });

  it('shows the empty state and disables Send when the vote has no invited voters', async () => {
    const { fixture } = await mount(of({ ready: [], missing_email: [], unique_email_count: 0, shared_email_voter_count: 0 }));
    current = fixture;

    expect(byTestId(fixture, 'vote-summary-dialog-empty')!.textContent).toContain('This vote has no invited voters.');
    expect(button(fixture, 'vote-summary-dialog-send').disabled).toBe(true);
  });

  it('disables Send when nobody can be emailed', async () => {
    const { fixture } = await mount(of({ ready: [], missing_email: [DREW], unique_email_count: 0, shared_email_voter_count: 0 }));
    current = fixture;

    expect(byTestId(fixture, 'vote-summary-dialog-nobody')!.textContent).toContain('Nobody can be emailed.');
    expect(byTestId(fixture, 'vote-summary-dialog-missing-r-4')).not.toBeNull();
    expect(button(fixture, 'vote-summary-dialog-send').disabled).toBe(true);
  });

  it.each([
    [new HttpErrorResponse({ status: 403 }), "You don't have permission to send this vote's summary."],
    [new HttpErrorResponse({ status: 409, error: { code: VOTE_SUMMARY_NOT_ENDED } }), 'This vote has not closed yet.'],
    [new HttpErrorResponse({ status: 500 }), "Couldn't load recipients."],
  ])('shows a load error %#, disables Send, and reloads on Retry', async (error, message) => {
    const { fixture, getVoteSummaryPreview } = await mount(throwError(() => error));
    current = fixture;

    const alert = byTestId(fixture, 'vote-summary-dialog-error')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain(message);
    expect(button(fixture, 'vote-summary-dialog-send').disabled).toBe(true);

    getVoteSummaryPreview.mockReturnValue(of(PREVIEW));
    button(fixture, 'vote-summary-dialog-retry').click();
    await render(fixture);

    expect(getVoteSummaryPreview).toHaveBeenCalledTimes(2);
    expect(byTestId(fixture, 'vote-summary-dialog-error')).toBeNull();
    expect(button(fixture, 'vote-summary-dialog-send').disabled).toBe(false);
    expect(document.activeElement).toBe(button(fixture, 'vote-summary-dialog-send'));
  });

  it.each(['ready', 'error', 'nobody'] as const)('keeps Retry focus inside the modal while loading, then focuses the %s action', async (outcome) => {
    const { fixture, getVoteSummaryPreview } = await mount(throwError(() => new HttpErrorResponse({ status: 500 })));
    current = fixture;
    const pending = new Subject<VoteSummaryPreviewResponse>();
    getVoteSummaryPreview.mockReturnValue(pending);
    button(fixture, 'vote-summary-dialog-retry').focus();
    button(fixture, 'vote-summary-dialog-retry').click();
    await render(fixture);
    expect(byTestId(fixture, 'vote-summary-dialog-loading')).not.toBeNull();
    expect(document.activeElement).toBe(button(fixture, 'vote-summary-dialog-cancel'));
    expect(byTestId(fixture, 'vote-summary-dialog-send-status')!.textContent).toContain('Loading recipients.');

    if (outcome === 'error') pending.error(new HttpErrorResponse({ status: 500 }));
    else {
      pending.next(outcome === 'ready' ? PREVIEW : { ...PREVIEW, ready: [], unique_email_count: 0 });
      pending.complete();
    }
    await render(fixture);
    let action = 'cancel';
    if (outcome === 'ready') action = 'send';
    else if (outcome === 'error') action = 'retry';
    expect(document.activeElement).toBe(button(fixture, `vote-summary-dialog-${action}`));
    expect(byTestId(fixture, 'vote-summary-dialog-send-status')!.textContent!.trim()).toBe('');
  });

  it.each([false, true])('identifies username-only voters in review and results (review-based fallback: %s)', async (fallback) => {
    const voter = { uid: 'r-lfid', username: 'drew-example' };
    const preview = { ...PREVIEW, missing_email: [voter] };
    const result: SendVoteSummaryResponse = { ...SENT, recipients: [...SENT.recipients.slice(0, 2), { ...voter, outcome: 'skipped' }] };
    const { fixture } = await mount(of(preview), fallback ? throwError(() => new HttpErrorResponse({ status: 0 })) : of(result));
    current = fixture;
    expect(byTestId(fixture, 'vote-summary-dialog-missing-r-lfid')!.textContent).toContain('drew-example');
    await sendNow(fixture);
    expect(byTestId(fixture, 'vote-summary-dialog-result-r-lfid')!.textContent).toContain('drew-example');
  });

  it('closes with false on Cancel and sends nothing', async () => {
    const { fixture, close, sendVoteSummary } = await mount(of(PREVIEW));
    current = fixture;

    button(fixture, 'vote-summary-dialog-cancel').click();

    expect(close).toHaveBeenCalledWith(false);
    expect(sendVoteSummary).not.toHaveBeenCalled();
  });

  it('asks for confirmation that emails cannot be recalled, and Back returns to the review without sending', async () => {
    const { fixture, sendVoteSummary } = await mount(of(PREVIEW));
    current = fixture;

    button(fixture, 'vote-summary-dialog-send').focus();
    button(fixture, 'vote-summary-dialog-send').click();
    await render(fixture);

    expect(byTestId(fixture, 'vote-summary-dialog-confirm-text')!.textContent).toContain(
      "Emails can't be recalled once sent. Send the summary to 2 email addresses?"
    );
    expect(sendVoteSummary).not.toHaveBeenCalled();
    const prompt = byTestId(fixture, 'vote-summary-dialog-confirm-text')!;
    expect(document.activeElement).toBe(prompt);
    expect(prompt.getAttribute('role')).toBeNull();
    expect(button(fixture, 'vote-summary-dialog-send-now').getAttribute('aria-describedby')).toBe(prompt.id);
    button(fixture, 'vote-summary-dialog-back').focus();

    button(fixture, 'vote-summary-dialog-back').click();
    await render(fixture);

    expect(byTestId(fixture, 'vote-summary-dialog-confirm-text')).toBeNull();
    expect(byTestId(fixture, 'vote-summary-dialog-send')).not.toBeNull();
    expect(document.activeElement).toBe(button(fixture, 'vote-summary-dialog-send'));
    expect(sendVoteSummary).not.toHaveBeenCalled();
  });

  it('shows the results grouped as Sent, Not sent, Missing email and Unconfirmed, focusing the summary', async () => {
    const result: SendVoteSummaryResponse = {
      recipient_count: 1,
      failed_count: 1,
      skipped_count: 1,
      uncertain_count: 1,
      recipients: [
        { ...DREW, outcome: 'skipped' },
        { ...CASEY, outcome: 'uncertain' },
        { ...BLAKE, outcome: 'failed' },
        { ...AVERY, outcome: 'sent' },
      ],
    };
    const { fixture, sendVoteSummary, close } = await mount(of(PREVIEW), of(result));
    current = fixture;

    await sendNow(fixture);
    await render(fixture);

    expect(sendVoteSummary).toHaveBeenCalledWith('vote-1');
    const groups = [...fixture.nativeElement.querySelectorAll('[data-testid^="vote-summary-dialog-group-"]')] as HTMLElement[];
    expect(groups.map((group) => group.getAttribute('data-testid'))).toEqual([
      'vote-summary-dialog-group-sent',
      'vote-summary-dialog-group-failed',
      'vote-summary-dialog-group-skipped',
      'vote-summary-dialog-group-uncertain',
    ]);
    expect(groups.map((group) => group.querySelector('lfx-tag')!.textContent!.trim())).toEqual(['Sent', 'Not sent', 'Missing email', 'Unconfirmed']);
    for (const group of groups) {
      const list = group.querySelector('ul')!;
      expect(list.tabIndex).toBe(0);
      expect(list.getAttribute('aria-labelledby')).toBe(group.querySelector('h4')!.id);
      expect(list.classList.contains('focus-visible:outline-2')).toBe(true);
    }
    expect(byTestId(fixture, 'vote-summary-dialog-group-sent')!.textContent).toContain('Inbox delivery and opens are not tracked.');

    const summary = byTestId(fixture, 'vote-summary-dialog-result-summary')!;
    expect(summary.getAttribute('aria-live')).toBe('polite');
    expect(summary.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(summary);
    expect(byTestId(fixture, 'vote-summary-dialog-result-heading')!.textContent).toContain('Summary delivery unconfirmed');
    expect(byTestId(fixture, 'vote-summary-dialog-vote-name')!.textContent).toContain('Spring Election');

    // Results offer only Close: no resend, retry or send action.
    expect(byTestId(fixture, 'vote-summary-dialog-send')).toBeNull();
    expect(byTestId(fixture, 'vote-summary-dialog-send-now')).toBeNull();
    expect(byTestId(fixture, 'vote-summary-dialog-retry')).toBeNull();
    expect(close).not.toHaveBeenCalled();

    button(fixture, 'vote-summary-dialog-close').click();
    expect(close).toHaveBeenCalledWith(true);
  });

  it.each(['sent', 'failed', 'uncertain'] as const)('counts every voter sharing an address in the %s result notice (#4830)', async (outcome) => {
    const result: SendVoteSummaryResponse = {
      recipient_count: outcome === 'sent' ? 2 : 1,
      failed_count: outcome === 'failed' ? 1 : 0,
      skipped_count: 1,
      uncertain_count: outcome === 'uncertain' ? 1 : 0,
      recipients: [
        { ...AVERY, outcome: 'sent' },
        { ...BLAKE, outcome },
        { ...CASEY, outcome },
        { ...DREW, outcome: 'skipped' },
      ],
    };
    const { fixture } = await mount(
      of({ ready: [AVERY, BLAKE, CASEY], missing_email: [DREW], unique_email_count: 2, shared_email_voter_count: 2 }),
      of(result)
    );
    current = fixture;

    await sendNow(fixture);

    const detail = byTestId(fixture, 'vote-summary-dialog-result-detail')!.textContent!;
    const group = byTestId(fixture, `vote-summary-dialog-group-${outcome}`)!;
    expect(group.querySelectorAll('li')).toHaveLength(outcome === 'sent' ? 3 : 2);
    expect(detail).toContain(outcome === 'sent' ? 'Sent to 3 voter(s)' : 'Sent to 1 voter(s)');
    expect(detail).toContain('1 skipped (no email address)');
    if (outcome === 'failed') expect(detail).toContain('2 failed');
    if (outcome === 'uncertain') expect(detail).toContain('2 unconfirmed');
    // Deriving display totals must not mutate the server's unique-address counters.
    expect(result.recipient_count).toBe(outcome === 'sent' ? 2 : 1);
    expect(result.failed_count).toBe(outcome === 'failed' ? 1 : 0);
    expect(result.uncertain_count).toBe(outcome === 'uncertain' ? 1 : 0);
  });

  it('counts shared-address voters individually in the unconfirmed fallback notice (#4830)', async () => {
    const { fixture } = await mount(
      of({ ready: [AVERY, BLAKE, CASEY], missing_email: [DREW], unique_email_count: 2, shared_email_voter_count: 2 }),
      throwError(() => new HttpErrorResponse({ status: 0 }))
    );
    current = fixture;

    await sendNow(fixture);

    expect(byTestId(fixture, 'vote-summary-dialog-group-uncertain')!.querySelectorAll('li')).toHaveLength(3);
    expect(byTestId(fixture, 'vote-summary-dialog-result-detail')!.textContent).toContain('3 unconfirmed');
    expect(byTestId(fixture, 'vote-summary-dialog-result-detail')!.textContent).toContain('1 voter(s) had no email address');
    expect(byTestId(fixture, 'vote-summary-dialog-result-detail')!.textContent).not.toContain('skipped');
  });

  it.each([undefined, null, {}])('falls back safely when a successful legacy response has recipients=%s', async (recipients) => {
    const legacy = { ...SENT, recipients } as unknown as SendVoteSummaryResponse;
    const { fixture } = await mount(of(PREVIEW), of(legacy));
    current = fixture;
    await sendNow(fixture);

    const detail = byTestId(fixture, 'vote-summary-dialog-result-detail')!.textContent!;
    expect(detail).toContain('Earlier review: 2 unconfirmed voter(s)');
    expect(detail).toContain('not confirmed send outcomes');
    expect(detail).toContain('Actual send-time recipients may differ or include voters not listed here');
    expect(detail).toContain('retrying may send duplicate summaries');
    const missing = byTestId(fixture, 'vote-summary-dialog-group-skipped')!;
    expect(missing.textContent).toContain('No email at review');
    expect(missing.textContent).toContain('Their send-time address and outcome are unknown');
    expect(missing.textContent).not.toContain('nothing could be sent');
    expect(byTestId(fixture, 'vote-summary-dialog-group-sent')).toBeNull();
    expect(byTestId(fixture, 'vote-summary-dialog-send-now')).toBeNull();
  });

  it('moves keyboard focus from Send now to Hide while sending while the request is pending', async () => {
    const pending = new Subject<SendVoteSummaryResponse>();
    const { fixture } = await mount(of(PREVIEW), pending);
    current = fixture;
    button(fixture, 'vote-summary-dialog-send').click();
    await render(fixture);
    const confirm = button(fixture, 'vote-summary-dialog-send-now');
    confirm.focus();
    confirm.click();
    await render(fixture);
    expect(confirm.disabled).toBe(true);
    expect(document.activeElement).toBe(button(fixture, 'vote-summary-dialog-hide'));
    expect(pending.observed).toBe(true);
  });

  it.each(['success', 'unconfirmed'] as const)('keeps focus on %s results when the send settles synchronously', async (outcome) => {
    const send = outcome === 'success' ? of(SENT) : throwError(() => new HttpErrorResponse({ status: 504 }));
    const { fixture } = await mount(of(PREVIEW), send);
    current = fixture;
    await sendNow(fixture);
    expect(byTestId(fixture, 'vote-summary-dialog-hide')).toBeNull();
    expect(document.activeElement).toBe(byTestId(fixture, 'vote-summary-dialog-result-summary'));
  });

  it('does not focus Hide when the request settles before the pending view renders', async () => {
    const pending = new Subject<SendVoteSummaryResponse>();
    const { fixture } = await mount(of(PREVIEW), pending);
    current = fixture;
    button(fixture, 'vote-summary-dialog-send').click();
    await render(fixture);
    button(fixture, 'vote-summary-dialog-send-now').click();
    pending.next(SENT);
    await render(fixture);
    expect(byTestId(fixture, 'vote-summary-dialog-hide')).toBeNull();
    expect(document.activeElement).toBe(byTestId(fixture, 'vote-summary-dialog-result-summary'));
  });

  it('locks the host header and Escape only while sending', async () => {
    const pending = new Subject<SendVoteSummaryResponse>();
    const { fixture, component, config, close } = await mount(of(PREVIEW), pending);
    current = fixture;
    const escape = (): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      return event;
    };
    expect(escape().defaultPrevented).toBe(false);
    const status = byTestId(fixture, 'vote-summary-dialog-send-status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.textContent!.trim()).toBe('');

    await sendNow(fixture);

    expect(status.textContent).toContain('Sending the summary.');
    expect(status.textContent).toContain('Hide while sending to use other actions; this does not cancel the send.');
    expect(escape().defaultPrevented).toBe(true);
    expect(config.closable).toBe(false);
    expect(button(fixture, 'vote-summary-dialog-back').disabled).toBe(true);
    expect(button(fixture, 'vote-summary-dialog-cancel').disabled).toBe(true);
    component['cancel']();
    expect(close).not.toHaveBeenCalled();

    pending.next(SENT);
    pending.complete();
    await render(fixture);

    expect(config.closable).toBe(true);
    expect(escape().defaultPrevented).toBe(false);
    expect(status.textContent!.trim()).toBe('');
  });

  it('hides a pending send, permits another vote send, and reopens without duplicate requests', async () => {
    const first = new Subject<SendVoteSummaryResponse>();
    const second = new Subject<SendVoteSummaryResponse>();
    const { fixture, config, close, getVoteSummaryPreview, sendVoteSummary } = await mount(of(PREVIEW), first);
    current = fixture;
    await sendNow(fixture);
    const service = TestBed.inject(VoteSummarySendService);
    const attempt = service.getAttempt('vote-1');
    expect(button(fixture, 'vote-summary-dialog-hide').disabled).toBe(false);
    button(fixture, 'vote-summary-dialog-hide').click();
    expect(close).toHaveBeenCalledWith(false);
    expect(service.getAttempt('vote-1')).toBe(attempt);
    expect(first.observed).toBe(true);
    fixture.destroy();

    config.data.vote = { uid: 'vote-2', name: 'Summer Election' };
    sendVoteSummary.mockReturnValue(second);
    const other = TestBed.createComponent(VoteSummaryDialogComponent);
    current = other;
    await render(other);
    await sendNow(other);
    expect(service.getAttempt('vote-2')?.status).toBe('sending');
    expect(service.getAttempt('vote-1')).toBe(attempt);
    button(other, 'vote-summary-dialog-hide').click();
    other.destroy();

    config.data.vote = { uid: 'vote-1', name: 'Spring Election' };
    const reopened = TestBed.createComponent(VoteSummaryDialogComponent);
    current = reopened;
    await render(reopened);
    expect(button(reopened, 'vote-summary-dialog-send-now').disabled).toBe(true);
    expect(getVoteSummaryPreview).toHaveBeenCalledTimes(2);
    expect(sendVoteSummary.mock.calls).toEqual([['vote-1'], ['vote-2']]);
    expect(service.send('vote-1', PREVIEW)).toBe(false);
    first.next(SENT);
    second.next(SENT);
    await render(reopened);
    expect(byTestId(reopened, 'vote-summary-dialog-vote-name')!.textContent).toContain('Spring Election');
    expect(byTestId(reopened, 'vote-summary-dialog-group-failed')).not.toBeNull();
    expect(sendVoteSummary).toHaveBeenCalledTimes(2);
  });

  it('retains a result that settles immediately before the sending view is hidden', async () => {
    const pending = new Subject<SendVoteSummaryResponse>();
    const { fixture, getVoteSummaryPreview, sendVoteSummary } = await mount(of(PREVIEW), pending);
    current = fixture;
    await sendNow(fixture);
    const service = TestBed.inject(VoteSummarySendService);
    pending.next(SENT);
    // The service has settled, but Angular has not updated the sending view yet.
    expect(service.getAttempt('vote-1')?.status).toBe('success');
    button(fixture, 'vote-summary-dialog-hide').click();
    expect(service.getAttempt('vote-1')?.status).toBe('success');
    fixture.destroy();
    const reopened = TestBed.createComponent(VoteSummaryDialogComponent);
    current = reopened;
    await render(reopened);
    expect(byTestId(reopened, 'vote-summary-dialog-group-failed')).not.toBeNull();
    expect(getVoteSummaryPreview).toHaveBeenCalledTimes(1);
    expect(sendVoteSummary).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'unconfirmed'] as const)('keeps focus in %s results when another vote starts and settles', async (outcome) => {
    const send = outcome === 'success' ? of(SENT) : throwError(() => new HttpErrorResponse({ status: 504 }));
    const { fixture, sendVoteSummary } = await mount(of(PREVIEW), send);
    current = fixture;
    await sendNow(fixture);
    const list = byTestId(fixture, `vote-summary-dialog-group-${outcome === 'success' ? 'failed' : 'uncertain'}`)!.querySelector('ul')!;
    list.focus();
    expect(document.activeElement).toBe(list);
    const result = fixture.componentInstance['result']();
    const other = new Subject<SendVoteSummaryResponse>();
    sendVoteSummary.mockReturnValue(other);
    const service = TestBed.inject(VoteSummarySendService);
    service.send('vote-2', PREVIEW);
    await render(fixture);
    expect(document.activeElement).toBe(list);
    other.next(SENT);
    await render(fixture);
    expect(document.activeElement).toBe(list);
    expect(fixture.componentInstance['result']()).toBe(result);
  });

  it('reports failed voters rather than email attempts when a shared address fails', async () => {
    const result: SendVoteSummaryResponse = {
      recipient_count: 0,
      failed_count: 1,
      skipped_count: 0,
      uncertain_count: 0,
      recipients: [
        { ...BLAKE, outcome: 'failed' },
        { ...CASEY, outcome: 'failed' },
      ],
    };
    const { fixture } = await mount(of({ ready: [BLAKE, CASEY], missing_email: [], unique_email_count: 1, shared_email_voter_count: 2 }), of(result));
    current = fixture;
    await sendNow(fixture);
    expect(byTestId(fixture, 'vote-summary-dialog-result-detail')!.textContent).toContain('2 voter(s) not sent');
    expect(byTestId(fixture, 'vote-summary-dialog-result-detail')!.textContent).not.toContain('send(s) failed');
    expect(byTestId(fixture, 'vote-summary-dialog-group-failed')!.querySelectorAll('li')).toHaveLength(2);
    expect(result.failed_count).toBe(1);
  });

  it.each(['success', 'unconfirmed'] as const)('clears %s results on host header closure and loads a fresh review when reopened', async (outcome) => {
    const send = outcome === 'success' ? of(SENT) : throwError(() => new HttpErrorResponse({ status: 504 }));
    const { fixture, close, getVoteSummaryPreview, sendVoteSummary } = await mount(of(PREVIEW), send);
    current = fixture;
    await sendNow(fixture);
    expect(TestBed.inject(VoteSummarySendService).getAttempt('vote-1')).toBeDefined();

    // PrimeNG's header X emits ref.onClose, unlike route destruction.
    close();
    expect(TestBed.inject(VoteSummarySendService).getAttempt('vote-1')).toBeUndefined();
    fixture.destroy();
    const reopened = TestBed.createComponent(VoteSummaryDialogComponent);
    current = reopened;
    await render(reopened);
    expect(getVoteSummaryPreview).toHaveBeenCalledTimes(2);
    expect(button(reopened, 'vote-summary-dialog-send').disabled).toBe(false);
    expect(sendVoteSummary).toHaveBeenCalledTimes(1);
  });

  it('retains settled results when navigation destroys the view without an explicit close', async () => {
    const { fixture, getVoteSummaryPreview, sendVoteSummary } = await mount(of(PREVIEW));
    current = fixture;
    await sendNow(fixture);
    fixture.destroy();
    const reopened = TestBed.createComponent(VoteSummaryDialogComponent);
    current = reopened;
    await render(reopened);
    expect(byTestId(reopened, 'vote-summary-dialog-group-failed')!.textContent).toContain('Blake Example');
    expect(byTestId(reopened, 'vote-summary-dialog-vote-name')!.textContent).toContain('Spring Election');
    expect(getVoteSummaryPreview).toHaveBeenCalledTimes(1);
    expect(sendVoteSummary).toHaveBeenCalledTimes(1);
  });

  it('lets an initiated send finish after destruction without scheduling a render on the destroyed view', async () => {
    const pending = new Subject<SendVoteSummaryResponse>();
    const { fixture, component } = await mount(of(PREVIEW), pending);
    current = fixture;
    await sendNow(fixture);

    fixture.destroy();
    expect(pending.observed).toBe(true);
    expect(() => component['showResults'](SENT)).not.toThrow();

    pending.next(SENT);
    pending.complete();
    expect(pending.observed).toBe(false);
  });

  it('restores a pending send after navigation, then its partial results without another POST or preview', async () => {
    const pending = new Subject<SendVoteSummaryResponse>();
    const { fixture, getVoteSummaryPreview, sendVoteSummary } = await mount(of(PREVIEW), pending);
    current = fixture;
    await sendNow(fixture);
    fixture.destroy();

    const reopened = TestBed.createComponent(VoteSummaryDialogComponent);
    current = reopened;
    await render(reopened);
    expect(button(reopened, 'vote-summary-dialog-send-now').disabled).toBe(true);
    expect(document.activeElement).toBe(button(reopened, 'vote-summary-dialog-hide'));
    expect(byTestId(reopened, 'vote-summary-dialog-send')).toBeNull();
    expect(sendVoteSummary).toHaveBeenCalledTimes(1);
    expect(getVoteSummaryPreview).toHaveBeenCalledTimes(1);

    pending.next(SENT);
    pending.complete();
    await render(reopened);
    expect(byTestId(reopened, 'vote-summary-dialog-group-failed')!.textContent).toContain('Blake Example');
    expect(TestBed.inject(VoteSummarySendService).getAttempt('vote-1')?.status).toBe('success');

    button(reopened, 'vote-summary-dialog-close').click();
    expect(TestBed.inject(VoteSummarySendService).getAttempt('vote-1')).toBeUndefined();
    reopened.destroy();
    const afterClose = TestBed.createComponent(VoteSummaryDialogComponent);
    current = afterClose;
    await render(afterClose);
    expect(button(afterClose, 'vote-summary-dialog-send').disabled).toBe(false);
    expect(sendVoteSummary).toHaveBeenCalledTimes(1);
  });

  it('restores an unconfirmed outcome that arrives while the dialog is destroyed', async () => {
    const pending = new Subject<SendVoteSummaryResponse>();
    const { fixture, sendVoteSummary } = await mount(of(PREVIEW), pending);
    current = fixture;
    await sendNow(fixture);
    fixture.destroy();
    pending.error(new HttpErrorResponse({ status: 504 }));

    const reopened = TestBed.createComponent(VoteSummaryDialogComponent);
    current = reopened;
    await render(reopened);
    expect(byTestId(reopened, 'vote-summary-dialog-group-uncertain')!.textContent).toContain('Avery Example');
    expect(byTestId(reopened, 'vote-summary-dialog-result-detail')!.textContent).toContain('retrying may send duplicate summaries');
    expect(sendVoteSummary).toHaveBeenCalledTimes(1);
    expect(byTestId(reopened, 'vote-summary-dialog-send')).toBeNull();
  });

  it('closes and clears recipient identities when the effective user changes', async () => {
    const { fixture, user, close } = await mount(of(PREVIEW));
    current = fixture;
    await sendNow(fixture);
    user.set({ sub: 'another-synthetic-manager' });
    await render(fixture);
    expect(close).toHaveBeenCalledWith(false);
    expect(byTestId(fixture, 'vote-summary-dialog-result-summary')).toBeNull();
    expect(TestBed.inject(VoteSummarySendService).getAttempt('vote-1')).toBeUndefined();
  });

  it.each([
    [new HttpErrorResponse({ status: 409, error: { code: VOTE_SUMMARY_NOT_ENDED } }), 'This vote has not closed yet.'],
    [new HttpErrorResponse({ status: 502, error: { code: VOTE_SUMMARY_PRECHECK_FAILED } }), 'Nothing was sent. Please try again.'],
    [new HttpErrorResponse({ status: 401, error: { code: VOTE_SUMMARY_PRECHECK_FAILED } }), 'Nothing was sent. Sign in again before sending a summary.'],
    [new HttpErrorResponse({ status: 404, error: { code: VOTE_SUMMARY_PRECHECK_FAILED } }), 'Nothing was sent. This vote is no longer available.'],
    [new HttpErrorResponse({ status: 403 }), 'No summaries were sent. Please try again.'],
    [new HttpErrorResponse({ status: 429 }), 'No summaries were sent. Please try again.'],
  ])('toasts a pre-send failure %# and returns to the review', async (error, detail) => {
    const { fixture, add } = await mount(
      of(PREVIEW),
      throwError(() => error)
    );
    current = fixture;

    await sendNow(fixture);

    expect(add).toHaveBeenCalledWith({ severity: 'error', summary: "Couldn't send summary", detail });
    expect(byTestId(fixture, 'vote-summary-dialog-send')).not.toBeNull();
    expect(document.activeElement).toBe(button(fixture, 'vote-summary-dialog-send'));
    expect(byTestId(fixture, 'vote-summary-dialog-result-summary')).toBeNull();
  });

  it('shows the per-voter results from a confirmed total-failure 502', async () => {
    const details: SendVoteSummaryResponse = {
      recipient_count: 0,
      failed_count: 2,
      skipped_count: 1,
      uncertain_count: 0,
      recipients: [
        { ...AVERY, outcome: 'failed' },
        { ...BLAKE, outcome: 'failed' },
        { ...DREW, outcome: 'skipped' },
      ],
    };
    const { fixture, add } = await mount(
      of(PREVIEW),
      throwError(() => new HttpErrorResponse({ status: 502, error: { code: VOTE_SUMMARY_SEND_FAILED, details } }))
    );
    current = fixture;

    await sendNow(fixture);

    expect(add).not.toHaveBeenCalled();
    expect(byTestId(fixture, 'vote-summary-dialog-result-heading')!.textContent).toContain('No summaries sent');
    expect(byTestId(fixture, 'vote-summary-dialog-group-failed')!.textContent).toContain('Avery Example');
    expect(byTestId(fixture, 'vote-summary-dialog-group-skipped')!.textContent).toContain('Drew Example');
    expect(byTestId(fixture, 'vote-summary-dialog-group-uncertain')).toBeNull();
  });

  it.each([
    [
      'a legacy 502 without recipients',
      new HttpErrorResponse({
        status: 502,
        error: { code: VOTE_SUMMARY_SEND_FAILED, details: { recipient_count: 0, failed_count: 2, skipped_count: 1, uncertain_count: 0 } },
      }),
    ],
    [
      'an invalid 502',
      new HttpErrorResponse({
        status: 502,
        error: { code: VOTE_SUMMARY_SEND_FAILED, details: { recipient_count: 0, failed_count: -1, skipped_count: 1, uncertain_count: 0, recipients: [] } },
      }),
    ],
    [
      'a 502 that reports uncertain sends',
      new HttpErrorResponse({ status: 502, error: { code: VOTE_SUMMARY_SEND_FAILED, details: { ...SENT, recipient_count: 0, uncertain_count: 1 } } }),
    ],
    ['a BFF transport-failure 502', new HttpErrorResponse({ status: 502, error: { code: VOTE_SUMMARY_SEND_FAILED, transport: true, details: SENT } })],
    ['a plain 502 without a BFF code', new HttpErrorResponse({ status: 502 })],
    ['a transport failure', new HttpErrorResponse({ status: 0 })],
    ['a timeout or unknown 5xx', new HttpErrorResponse({ status: 504 })],
    ['the client send deadline', new TimeoutError()],
    ['a non-HTTP error', new Error('boom')],
  ])('shows every emailable voter as Unconfirmed with the duplicate warning after %s', async (_label, error) => {
    const { fixture, add } = await mount(
      of(PREVIEW),
      throwError(() => error)
    );
    current = fixture;

    await sendNow(fixture);

    expect(add).not.toHaveBeenCalled();
    expect(byTestId(fixture, 'vote-summary-dialog-result-heading')!.textContent).toContain('Summary delivery unconfirmed');
    expect(byTestId(fixture, 'vote-summary-dialog-result-detail')!.textContent).toContain('retrying may send duplicate summaries');
    const uncertain = byTestId(fixture, 'vote-summary-dialog-group-uncertain')!;
    expect(uncertain.textContent).toContain('Avery Example');
    expect(uncertain.textContent).toContain('Blake Example');
    expect(uncertain.textContent).toContain('sending again could create duplicates');
    expect(byTestId(fixture, 'vote-summary-dialog-group-skipped')!.textContent).toContain('Drew Example');
    expect(byTestId(fixture, 'vote-summary-dialog-group-skipped')!.textContent).toContain('No email at review');
    expect(byTestId(fixture, 'vote-summary-dialog-group-skipped')!.textContent).not.toContain('nothing could be sent');
    expect(byTestId(fixture, 'vote-summary-dialog-result-detail')!.textContent).toContain('not confirmed send outcomes');
    expect(byTestId(fixture, 'vote-summary-dialog-group-sent')).toBeNull();
    expect(byTestId(fixture, 'vote-summary-dialog-close')).not.toBeNull();
  });
});
