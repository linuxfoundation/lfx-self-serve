// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { CreateArtifactDialogComponent } from '@components/create-artifact-dialog/create-artifact-dialog.component';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { CreateArtifactDialogService } from './create-artifact-dialog.service';

describe('CreateArtifactDialogService', () => {
  it('opens the headless picker for the type and names the dialog from its heading', () => {
    const ref = new DynamicDialogRef();
    const host = { setInput: vi.fn(), changeDetectorRef: { detectChanges: vi.fn() } };
    const open = vi.fn(() => ref);
    TestBed.configureTestingModule({
      providers: [{ provide: DialogService, useValue: { open, dialogComponentRefMap: new Map([[ref, host]]) } }],
    });

    TestBed.inject(CreateArtifactDialogService).open('meeting');

    expect(open).toHaveBeenCalledWith(
      CreateArtifactDialogComponent,
      expect.objectContaining({ showHeader: false, modal: true, dismissableMask: true, data: { type: 'meeting' } })
    );
    expect(host.setInput).toHaveBeenCalledWith('pt', { pcDialog: { root: { 'aria-labelledby': CreateArtifactDialogComponent.headingId } } });
  });
});
