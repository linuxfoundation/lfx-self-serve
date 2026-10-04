// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { INSIGHTS_TOKEN_COPIED_RESET_MS } from '@lfx-one/shared/constants';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InsightsTokenRevealDialogComponent } from './insights-token-reveal-dialog.component';

describe('InsightsTokenRevealDialogComponent', () => {
  let writeText: ReturnType<typeof vi.fn>;
  let messageService: { add: ReturnType<typeof vi.fn> };
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let component: InsightsTokenRevealDialogComponent;

  const create = (data: unknown): void => {
    TestBed.configureTestingModule({
      imports: [InsightsTokenRevealDialogComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: MessageService, useValue: messageService },
        { provide: DynamicDialogRef, useValue: dialogRef },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    });
    TestBed.overrideComponent(InsightsTokenRevealDialogComponent, { set: { template: '', imports: [] } });
    component = TestBed.createComponent(InsightsTokenRevealDialogComponent).componentInstance;
  };

  beforeEach(() => {
    writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    messageService = { add: vi.fn() };
    dialogRef = { close: vi.fn() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('copies the secret and resets the copied state after the timeout', async () => {
    vi.useFakeTimers();
    create({ name: 'ci-pipeline', secret: 'lfi_secret' });

    await component['copy']();

    expect(writeText).toHaveBeenCalledWith('lfi_secret');
    expect(component['copied']()).toBe(true);
    vi.advanceTimersByTime(INSIGHTS_TOKEN_COPIED_RESET_MS);
    expect(component['copied']()).toBe(false);
  });

  it('never builds a DOM node holding the secret, which Session Replay could record', async () => {
    create({ name: 'ci-pipeline', secret: 'lfi_secret' });

    // Spy on insertion, not just the final DOM: a fallback that appends a textarea and removes it
    // again would leave body clean afterwards but still be captured by Session Replay.
    const appendChild = vi.spyOn(Node.prototype, 'appendChild');
    const insertBefore = vi.spyOn(Node.prototype, 'insertBefore');

    await component['copy']();

    for (const [node] of [...appendChild.mock.calls, ...insertBefore.mock.calls]) {
      expect((node as Node).textContent ?? '').not.toContain('lfi_secret');
      expect((node as HTMLTextAreaElement).value ?? '').not.toContain('lfi_secret');
    }
    expect(document.body.innerHTML).not.toContain('lfi_secret');
  });

  it('toasts an error when the clipboard copy fails', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    create({ name: 'ci-pipeline', secret: 'lfi_secret' });

    await component['copy']();

    expect(component['copied']()).toBe(false);
    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('toasts an error when the Clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    create({ name: 'ci-pipeline', secret: 'lfi_secret' });

    await component['copy']();

    expect(component['copied']()).toBe(false);
    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('does not attempt to copy when no secret was passed', async () => {
    create({ name: 'ci-pipeline' });

    await component['copy']();

    expect(writeText).not.toHaveBeenCalled();
    expect(messageService.add).toHaveBeenCalled();
  });

  it('closes the dialog', () => {
    create({ name: 'ci-pipeline', secret: 'lfi_secret' });

    component['close']();

    expect(dialogRef.close).toHaveBeenCalled();
  });
});
