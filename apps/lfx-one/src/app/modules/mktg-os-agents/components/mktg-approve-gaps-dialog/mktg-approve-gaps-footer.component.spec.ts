// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';
import { MktgApproveGapsFooterComponent } from './mktg-approve-gaps-footer.component';

describe('Approval with open gaps dialog footer', () => {
  const close = vi.fn();
  const render = async (): Promise<HTMLElement> => {
    close.mockReset();
    TestBed.configureTestingModule({
      imports: [MktgApproveGapsFooterComponent],
      providers: [{ provide: DynamicDialogRef, useValue: { close } }],
    });
    const fixture = TestBed.createComponent(MktgApproveGapsFooterComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('renders both buttons and closes nothing on its own', async () => {
    const root = await render();
    expect(root.querySelector('[data-testid="mktg-document-view-approve-cancel"] button')).not.toBeNull();
    expect(root.querySelector('[data-testid="mktg-document-view-approve-anyway"] button')).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it.each([
    ['cancel', false],
    ['anyway', true],
  ] as const)('%s closes the dialog once with %s', async (action, result) => {
    const root = await render();
    root.querySelector<HTMLButtonElement>(`[data-testid="mktg-document-view-approve-${action}"] button`)?.click();
    expect(close).toHaveBeenCalledExactlyOnceWith(result);
  });
});
