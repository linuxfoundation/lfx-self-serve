// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ShareDialogComponent } from '@components/share-dialog/share-dialog.component';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { ShareDialogService } from './share-dialog.service';

describe('ShareDialogService', () => {
  const data = { url: 'https://app.lfx.dev/newsletters/cncf/abc123', title: 'K8s Weekly #42' };

  function setup(host: unknown): { open: ReturnType<typeof vi.fn> } {
    const ref = new DynamicDialogRef();
    const open = vi.fn(() => ref);
    TestBed.configureTestingModule({
      providers: [{ provide: DialogService, useValue: { open, dialogComponentRefMap: new Map(host ? [[ref, host]] : []) } }],
    });
    return { open };
  }

  it('opens the headless share dialog with the data and names it from its heading', () => {
    const host = { setInput: vi.fn(), changeDetectorRef: { detectChanges: vi.fn() } };
    const { open } = setup(host);

    TestBed.inject(ShareDialogService).open(data);

    expect(open).toHaveBeenCalledWith(
      ShareDialogComponent,
      expect.objectContaining({ showHeader: false, modal: true, dismissableMask: true, breakpoints: { '640px': '92vw' }, data })
    );
    expect(host.setInput).toHaveBeenCalledWith('pt', { pcDialog: { root: { 'aria-labelledby': ShareDialogComponent.headingId } } });
  });

  it('still opens when the dialog host is not registered', () => {
    const { open } = setup(null);

    expect(() => TestBed.inject(ShareDialogService).open(data)).not.toThrow();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
