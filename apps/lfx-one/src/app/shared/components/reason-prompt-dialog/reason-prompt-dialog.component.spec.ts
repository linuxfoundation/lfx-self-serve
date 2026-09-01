// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import type { ReasonPromptDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReasonPromptDialogComponent } from './reason-prompt-dialog.component';

describe('ReasonPromptDialogComponent', () => {
  let close: ReturnType<typeof vi.fn>;

  function create(data: ReasonPromptDialogData): ReasonPromptDialogComponent {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [ReasonPromptDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    });
    return TestBed.createComponent(ReasonPromptDialogComponent).componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('exposes the dialog config data for the template', () => {
    const component = create({ prompt: 'Skip "X"?', placeholder: 'Why?', confirmLabel: 'Skip item' });

    expect(component.data.prompt).toBe('Skip "X"?');
    expect(component.data.confirmLabel).toBe('Skip item');
  });

  it('does not close the dialog when confirming with an empty reason', () => {
    const component = create({ prompt: 'Skip?', placeholder: 'Why?', confirmLabel: 'Skip item' });

    (component as unknown as { onConfirm: () => void }).onConfirm();

    expect(close).not.toHaveBeenCalled();
  });

  it('does not close the dialog when confirming with a whitespace-only reason', () => {
    const component = create({ prompt: 'Skip?', placeholder: 'Why?', confirmLabel: 'Skip item' });
    component.form.controls.reason.setValue('   ');

    (component as unknown as { onConfirm: () => void }).onConfirm();

    expect(close).not.toHaveBeenCalled();
  });

  it('closes with the trimmed reason when confirming with real content', () => {
    const component = create({ prompt: 'Skip?', placeholder: 'Why?', confirmLabel: 'Skip item' });
    component.form.controls.reason.setValue('  blocked upstream  ');

    (component as unknown as { onConfirm: () => void }).onConfirm();

    expect(close).toHaveBeenCalledWith({ reason: 'blocked upstream' });
  });

  it('closes with no result when cancelling', () => {
    const component = create({ prompt: 'Skip?', placeholder: 'Why?', confirmLabel: 'Skip item' });

    (component as unknown as { onCancel: () => void }).onCancel();

    expect(close).toHaveBeenCalledWith();
  });
});
