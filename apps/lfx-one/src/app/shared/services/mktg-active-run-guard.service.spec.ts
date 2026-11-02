// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MktgActiveRunConflict, MktgActiveRunGuardOptions } from '@lfx-one/shared/interfaces';
import { ConfirmationService, ConfirmEventType, MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgActiveRunGuardService } from './mktg-active-run-guard.service';

const conflict: MktgActiveRunConflict = {
  code: 'MKTG_RUN_ACTIVE',
  message: 'A run is in progress.',
  activeRunId: 'b'.repeat(64),
  state: 'writing',
  agentKey: 'faq',
  documentId: 'living',
  startedBy: 'Synthetic writer',
  startedByViewer: false,
  startedAt: '2026-10-19T12:00:00Z',
};

describe('shared active-run guard dialog', () => {
  let service: MktgActiveRunGuardService;
  let confirmation: ConfirmationService;
  let options: MktgActiveRunGuardOptions<string>;
  const messages = { add: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: MessageService, useValue: messages },
      ],
    });
    service = TestBed.inject(MktgActiveRunGuardService);
    confirmation = new ConfirmationService();
    vi.spyOn(confirmation, 'confirm');
    vi.spyOn(confirmation, 'close');
    options = {
      conflict,
      current: () => true,
      recheck: vi.fn(() => throwError(() => conflict)),
      classify: (error) => (error === conflict ? conflict : null),
      onValue: vi.fn(),
      onOpen: vi.fn(),
      onDiscard: vi.fn(),
      onError: vi.fn(),
    };
  });

  it('paints neutrally first and updates the same dialog with fresh ownership/time without closing it', () => {
    const headers: (string | undefined)[] = [];
    vi.mocked(confirmation.confirm).mockImplementation((dialog) => {
      headers.push(dialog.header);
      return confirmation;
    });
    const fresh = { ...conflict, startedByViewer: true, activeRunId: 'c'.repeat(64), startedAt: '2026-10-19T13:00:00Z' };
    service.open(confirmation, options, TestBed.inject(DestroyRef));
    expect(headers[0]).toBe('Checking the active run…');
    options.classify = () => fresh;
    window.dispatchEvent(new Event('focus'));
    const dialog = vi.mocked(confirmation.confirm).mock.calls.at(-1)?.[0];
    expect(dialog?.header).toBe('Your FAQ run is in progress');
    expect(dialog?.message).toContain('19 Oct 2026');
    expect(confirmation.close).not.toHaveBeenCalled();
    expect(vi.mocked(confirmation.confirm).mock.calls.every(([value]) => value === dialog)).toBe(true);
    dialog?.reject?.(ConfirmEventType.REJECT);
    expect(options.onOpen).toHaveBeenCalledWith(fresh);
  });

  it('disables both choices during one slow POST, then discards only the freshly returned run once', () => {
    const response = new Subject<string>();
    options.recheck = vi.fn(() => response);
    service.open(confirmation, options, TestBed.inject(DestroyRef));
    const dialog = vi.mocked(confirmation.confirm).mock.calls.at(-1)?.[0];
    expect(dialog?.acceptButtonProps.disabled).toBe(true);
    dialog?.accept?.();
    window.dispatchEvent(new Event('focus'));
    expect(options.onDiscard).not.toHaveBeenCalled();
    expect(options.recheck).toHaveBeenCalledOnce();
    response.error(conflict);
    dialog?.accept?.();
    dialog?.accept?.();
    expect(options.onDiscard).toHaveBeenCalledExactlyOnceWith(conflict);
  });

  it('closes on an accepted recheck, announces the sentence and follows the normal start result', () => {
    service.open(confirmation, options, TestBed.inject(DestroyRef));
    options.recheck = vi.fn(() => of('synthetic-session'));
    window.dispatchEvent(new Event('focus'));
    expect(confirmation.close).toHaveBeenCalledOnce();
    expect(messages.add).toHaveBeenCalledExactlyOnceWith({ severity: 'info', detail: 'The earlier run has finished — yours started.' });
    expect(options.onValue).toHaveBeenCalledExactlyOnceWith('synthetic-session');
    window.dispatchEvent(new Event('focus'));
    expect(options.recheck).toHaveBeenCalledOnce();
  });
});
