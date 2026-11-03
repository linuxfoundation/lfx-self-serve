// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VOTE_SUMMARY_NOT_ENDED, VOTE_SUMMARY_PRECHECK_FAILED, VOTE_SUMMARY_SEND_FAILED } from '@lfx-one/shared/constants';
import { SendVoteSummaryResponse, VoteSummaryPreviewResponse } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
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
  const close = vi.fn();
  const config = { data: { vote: { uid: 'vote-1', name: 'Spring Election' } }, closable: true };

  TestBed.configureTestingModule({
    imports: [VoteSummaryDialogComponent],
    providers: [
      { provide: DynamicDialogRef, useValue: { close } },
      { provide: DynamicDialogConfig, useValue: config },
      { provide: VoteService, useValue: { getVoteSummaryPreview, sendVoteSummary } },
      { provide: MessageService, useValue: { add } },
    ],
  });

  const fixture = TestBed.createComponent(VoteSummaryDialogComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, component: fixture.componentInstance, config, getVoteSummaryPreview, sendVoteSummary, add, close };
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

    const list = byTestId(fixture, 'vote-summary-dialog-ready')!.querySelector('ul')!;
    expect(list.classList.contains('overflow-auto')).toBe(true);
    expect(list.classList.contains('max-h-[min(32rem,calc(90dvh-14rem))]')).toBe(true);
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

    button(fixture, 'vote-summary-dialog-send').click();
    await render(fixture);

    expect(byTestId(fixture, 'vote-summary-dialog-confirm-text')!.textContent).toContain(
      "Emails can't be recalled once sent. Send the summary to 2 email addresses?"
    );
    expect(sendVoteSummary).not.toHaveBeenCalled();

    button(fixture, 'vote-summary-dialog-back').click();
    await render(fixture);

    expect(byTestId(fixture, 'vote-summary-dialog-confirm-text')).toBeNull();
    expect(byTestId(fixture, 'vote-summary-dialog-send')).not.toBeNull();
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
    expect(byTestId(fixture, 'vote-summary-dialog-group-sent')!.textContent).toContain('Inbox delivery and opens are not tracked.');

    const summary = byTestId(fixture, 'vote-summary-dialog-result-summary')!;
    expect(summary.getAttribute('aria-live')).toBe('polite');
    expect(summary.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(summary);
    expect(byTestId(fixture, 'vote-summary-dialog-result-heading')!.textContent).toContain('Summary delivery unconfirmed');

    // Results offer only Close: no resend, retry or send action.
    expect(byTestId(fixture, 'vote-summary-dialog-send')).toBeNull();
    expect(byTestId(fixture, 'vote-summary-dialog-send-now')).toBeNull();
    expect(byTestId(fixture, 'vote-summary-dialog-retry')).toBeNull();
    expect(close).not.toHaveBeenCalled();

    button(fixture, 'vote-summary-dialog-close').click();
    expect(close).toHaveBeenCalledWith(true);
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

    await sendNow(fixture);

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
    expect(byTestId(fixture, 'vote-summary-dialog-group-sent')).toBeNull();
    expect(byTestId(fixture, 'vote-summary-dialog-close')).not.toBeNull();
  });
});
