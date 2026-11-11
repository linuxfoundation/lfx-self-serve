// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { SURVEY_FOLLOW_UP_PRECHECK_FAILED } from '@lfx-one/shared/constants';
import { Survey, SurveyResyncPreview } from '@lfx-one/shared/interfaces';
import { SurveyService } from '@services/survey.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SurveyResyncDialogComponent } from './survey-resync-dialog.component';

const PREVIEW: SurveyResyncPreview = {
  affected_recipients: [{ user_id: 'u-1', email: 'new@example.com', name: 'New Member', role: 'Voting Rep' }],
  affected_committees: [],
};

async function mount(preview$: Observable<SurveyResyncPreview> = of(PREVIEW), committeeUids: string[] = ['c-1']) {
  TestBed.resetTestingModule();
  const getResyncPreview = vi.fn().mockReturnValue(preview$);
  const resyncRecipients = vi.fn().mockReturnValue(of(undefined));
  const add = vi.fn();
  const close = vi.fn();
  TestBed.configureTestingModule({
    imports: [SurveyResyncDialogComponent],
    providers: [
      { provide: DynamicDialogRef, useValue: { close } },
      { provide: DynamicDialogConfig, useValue: { data: { survey: { uid: 's-1' } as Survey, committeeUids }, closable: true } },
      { provide: SurveyService, useValue: { getResyncPreview, resyncRecipients } },
      { provide: MessageService, useValue: { add } },
    ],
  });
  const fixture = TestBed.createComponent(SurveyResyncDialogComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, component: fixture.componentInstance, getResyncPreview, resyncRecipients, add, close };
}

const byTestId = (fixture: { nativeElement: HTMLElement }, id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

describe('SurveyResyncDialogComponent', () => {
  it("previews the project's committee and resyncs it on confirm", async () => {
    const { fixture, component, getResyncPreview, resyncRecipients, close } = await mount();

    expect(getResyncPreview).toHaveBeenCalledWith('s-1', 'c-1');
    expect(byTestId(fixture, 'survey-resync-dialog-row-u-1')).not.toBeNull();

    component['send']();

    expect(resyncRecipients).toHaveBeenCalledWith('s-1', 'c-1');
    expect(close).toHaveBeenCalledWith(true);
  });

  it('sends nothing when no one is missing', async () => {
    const { fixture, component, resyncRecipients } = await mount(of({ affected_recipients: [], affected_committees: [] }));

    component['send']();

    expect(byTestId(fixture, 'survey-resync-dialog-empty')).not.toBeNull();
    expect(resyncRecipients).not.toHaveBeenCalled();
  });

  it('shows a retryable error when the preview fails', async () => {
    const { fixture } = await mount(throwError(() => new HttpErrorResponse({ status: 403 })));
    fixture.detectChanges();

    expect(byTestId(fixture, 'survey-resync-dialog-error')?.textContent).toContain("don't have permission");
  });

  it("previews each of the project's committees, lists a shared member once, and resyncs only committees with someone missing", async () => {
    TestBed.resetTestingModule();
    const empty: SurveyResyncPreview = { affected_recipients: [], affected_committees: [] };
    const previews: Record<string, SurveyResyncPreview> = { 'c-1': PREVIEW, 'c-2': PREVIEW, 'c-3': empty };
    const getResyncPreview = vi.fn((_uid: string, committeeUid: string) => of(previews[committeeUid]));
    const resyncRecipients = vi.fn().mockReturnValue(of(undefined));
    const close = vi.fn();
    TestBed.configureTestingModule({
      imports: [SurveyResyncDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { survey: { uid: 's-1' } as Survey, committeeUids: ['c-1', 'c-2', 'c-3'] } } },
        { provide: SurveyService, useValue: { getResyncPreview, resyncRecipients } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(SurveyResyncDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    expect(component['recipients']()).toHaveLength(1);
    component['send']();

    expect(resyncRecipients.mock.calls).toEqual([
      ['s-1', 'c-1'],
      ['s-1', 'c-2'],
    ]);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('after a partial failure, reports it, previews only the remaining committees, and retries only those', async () => {
    TestBed.resetTestingModule();
    const getResyncPreview = vi.fn().mockReturnValue(of(PREVIEW));
    const resyncRecipients = vi
      .fn()
      .mockReturnValueOnce(of(undefined))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 429 })))
      .mockReturnValue(of(undefined));
    const add = vi.fn();
    const close = vi.fn();
    TestBed.configureTestingModule({
      imports: [SurveyResyncDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { survey: { uid: 's-1' } as Survey, committeeUids: ['c-1', 'c-2'] } } },
        { provide: SurveyService, useValue: { getResyncPreview, resyncRecipients } },
        { provide: MessageService, useValue: { add } },
      ],
    });
    const fixture = TestBed.createComponent(SurveyResyncDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    component['send']();

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warn', summary: 'Resync partly sent', detail: expect.stringContaining('Sent for 1 of 2 groups') })
    );
    expect(getResyncPreview.mock.calls.at(-1)).toEqual(['s-1', 'c-2']);
    expect(close).not.toHaveBeenCalled();

    component['send']();
    expect(resyncRecipients.mock.calls).toEqual([
      ['s-1', 'c-1'],
      ['s-1', 'c-2'],
      ['s-1', 'c-2'],
    ]);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('does not claim nothing was sent when a later group fails its access check', async () => {
    TestBed.resetTestingModule();
    const getResyncPreview = vi.fn().mockReturnValue(of(PREVIEW));
    const resyncRecipients = vi
      .fn()
      .mockReturnValueOnce(of(undefined))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, error: { code: SURVEY_FOLLOW_UP_PRECHECK_FAILED } })));
    const add = vi.fn();
    TestBed.configureTestingModule({
      imports: [SurveyResyncDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: { survey: { uid: 's-1' } as Survey, committeeUids: ['c-1', 'c-2'] } } },
        { provide: SurveyService, useValue: { getResyncPreview, resyncRecipients } },
        { provide: MessageService, useValue: { add } },
      ],
    });
    const fixture = TestBed.createComponent(SurveyResyncDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance['send']();

    const detail: string = add.mock.calls.at(-1)?.[0].detail;
    expect(detail).toContain('Sent for 1 of 2 groups');
    expect(detail).toContain("The remaining groups weren't sent");
    expect(detail).not.toContain('Nothing was sent');
  });

  it('asks the drawer to reload when cancelled after a partial resync', async () => {
    TestBed.resetTestingModule();
    const close = vi.fn();
    TestBed.configureTestingModule({
      imports: [SurveyResyncDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { survey: { uid: 's-1' } as Survey, committeeUids: ['c-1', 'c-2'] } } },
        {
          provide: SurveyService,
          useValue: {
            getResyncPreview: vi.fn().mockReturnValue(of(PREVIEW)),
            resyncRecipients: vi
              .fn()
              .mockReturnValueOnce(of(undefined))
              .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 }))),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(SurveyResyncDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance['send']();
    fixture.componentInstance['cancel']();

    expect(close).toHaveBeenCalledWith(true);
  });

  it('says the survey is no longer available on a 404, not that the send is unconfirmed', async () => {
    const { fixture } = await mount(throwError(() => new HttpErrorResponse({ status: 404 })));
    expect(fixture.nativeElement.textContent).toContain('no longer available');
  });

  it('says nothing was sent when the access check could not run', async () => {
    const { fixture } = await mount(throwError(() => new HttpErrorResponse({ status: 503, error: { code: SURVEY_FOLLOW_UP_PRECHECK_FAILED } })));
    fixture.detectChanges();

    expect(byTestId(fixture, 'survey-resync-dialog-error')?.textContent).toContain('Nothing was sent');
  });
});
