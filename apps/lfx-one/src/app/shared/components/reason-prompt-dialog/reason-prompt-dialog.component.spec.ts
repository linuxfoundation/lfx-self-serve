// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ReasonPromptDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReasonPromptDialogComponent } from './reason-prompt-dialog.component';

describe('ReasonPromptDialogComponent', () => {
  let fixture: ComponentFixture<ReasonPromptDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  function textarea(): HTMLTextAreaElement {
    return fixture.nativeElement.querySelector('textarea[data-test="reason-prompt-dialog-textarea"]');
  }

  function confirmButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="reason-prompt-dialog-confirm"] button');
  }

  function cancelButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="reason-prompt-dialog-cancel"] button');
  }

  async function typeReason(value: string): Promise<void> {
    const el = textarea();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function create(data: ReasonPromptDialogData): void {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [ReasonPromptDialogComponent],
      providers: [provideRouter([]), { provide: DynamicDialogRef, useValue: { close } }, { provide: DynamicDialogConfig, useValue: { data } }],
    });
    fixture = TestBed.createComponent(ReasonPromptDialogComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
  });

  beforeEach(() => create({ prompt: 'Skip "X"?', placeholder: 'Why?', confirmLabel: 'Skip item' }));

  it('renders the dialog config data in the template', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="reason-prompt-dialog"]').textContent).toContain('Skip "X"?');
    expect(confirmButton().textContent).toContain('Skip item');
  });

  it('starts with Confirm disabled until a non-blank reason is typed', async () => {
    expect(confirmButton().disabled).toBe(true);

    await typeReason('   ');
    expect(confirmButton().disabled).toBe(true);

    await typeReason('blocked upstream');
    expect(confirmButton().disabled).toBe(false);
  });

  it('Confirm closes with the trimmed reason', async () => {
    await typeReason('  blocked upstream  ');

    confirmButton().click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledWith({ reason: 'blocked upstream' });
  });

  it('Confirm is a no-op while disabled (whitespace-only reason)', async () => {
    await typeReason('   ');

    confirmButton().click();
    await fixture.whenStable();

    expect(close).not.toHaveBeenCalled();
  });

  it('Cancel closes with no result, regardless of what was typed', async () => {
    await typeReason('blocked upstream');

    cancelButton().click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledWith();
  });
});
