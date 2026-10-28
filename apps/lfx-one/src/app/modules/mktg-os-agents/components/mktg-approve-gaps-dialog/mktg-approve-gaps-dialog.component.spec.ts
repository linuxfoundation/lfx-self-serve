// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import type { MktgAssetReport } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';
import { MktgApproveGapsDialogComponent } from './mktg-approve-gaps-dialog.component';

describe('Approval with open gaps dialog', () => {
  it.each([
    ['cancel', false],
    ['anyway', true],
  ] as const)('lists the report as text and returns %s', async (action, result) => {
    const close = vi.fn();
    const report: MktgAssetReport = { sources_read: [], sources_failed: [{ name: 'Docs', reason: '404' }], gaps: ['<b>Missing</b>'], notes: '' };
    TestBed.configureTestingModule({
      imports: [MktgApproveGapsDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: report } },
      ],
    });
    const fixture = TestBed.createComponent(MktgApproveGapsDialogComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain('Docs — 404');
    expect(root.textContent).toContain('<b>Missing</b>');
    expect(root.querySelector('b')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>(`[data-testid="mktg-document-view-approve-${action}"] button`)?.click();
    expect(close).toHaveBeenCalledExactlyOnceWith(result);
  });
});
