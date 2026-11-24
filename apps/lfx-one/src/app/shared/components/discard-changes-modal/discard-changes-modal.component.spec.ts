// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscardChangesModalComponent } from './discard-changes-modal.component';

describe('DiscardChangesModalComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let root: HTMLElement;
  const button = (testId: string) => root.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement;

  beforeEach(() => {
    close = vi.fn();
    const fixture = TestBed.configureTestingModule({
      imports: [DiscardChangesModalComponent],
      providers: [{ provide: DialogRef, useValue: { close, id: 'lfx-ui-modal-test' } }],
    }).createComponent(DiscardChangesModalComponent);
    fixture.detectChanges();
    root = fixture.nativeElement;
  });

  it('asks in the design copy', () => {
    expect(root.textContent).toContain('Discard unsaved changes?');
    expect(root.textContent).toContain("You've made changes that haven't been saved. If you leave now, they'll be lost.");
  });

  it('stays on "Keep editing" and leaves on "Discard changes"', () => {
    button('discard-changes-keep').click();
    expect(close).toHaveBeenLastCalledWith(false);

    button('discard-changes-confirm').click();
    expect(close).toHaveBeenLastCalledWith(true);
  });
});
