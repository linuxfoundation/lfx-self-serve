// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { INSIGHTS_TOKEN_COPIED_RESET_MS } from '@lfx-one/shared/constants';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InsightsTokenRevealDialogComponent } from './insights-token-reveal-dialog.component';

describe('InsightsTokenRevealDialogComponent', () => {
  let clipboard: { copy: ReturnType<typeof vi.fn> };
  let messageService: { add: ReturnType<typeof vi.fn> };
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let component: InsightsTokenRevealDialogComponent;

  const create = (data: unknown): void => {
    TestBed.configureTestingModule({
      imports: [InsightsTokenRevealDialogComponent],
      providers: [
        { provide: Clipboard, useValue: clipboard },
        { provide: MessageService, useValue: messageService },
        { provide: DynamicDialogRef, useValue: dialogRef },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    });
    TestBed.overrideComponent(InsightsTokenRevealDialogComponent, { set: { template: '', imports: [] } });
    component = TestBed.createComponent(InsightsTokenRevealDialogComponent).componentInstance;
  };

  beforeEach(() => {
    clipboard = { copy: vi.fn(() => true) };
    messageService = { add: vi.fn() };
    dialogRef = { close: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('copies the secret and resets the copied state after the timeout', () => {
    vi.useFakeTimers();
    create({ name: 'ci-pipeline', secret: 'lfi_secret' });

    component['copy']();

    expect(clipboard.copy).toHaveBeenCalledWith('lfi_secret');
    expect(component['copied']()).toBe(true);
    vi.advanceTimersByTime(INSIGHTS_TOKEN_COPIED_RESET_MS);
    expect(component['copied']()).toBe(false);
  });

  it('toasts an error when the clipboard copy fails', () => {
    clipboard.copy.mockReturnValue(false);
    create({ name: 'ci-pipeline', secret: 'lfi_secret' });

    component['copy']();

    expect(component['copied']()).toBe(false);
    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('does not attempt to copy when no secret was passed', () => {
    create({ name: 'ci-pipeline' });

    component['copy']();

    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(messageService.add).toHaveBeenCalled();
  });

  it('closes the dialog', () => {
    create({ name: 'ci-pipeline', secret: 'lfi_secret' });

    component['close']();

    expect(dialogRef.close).toHaveBeenCalled();
  });
});
