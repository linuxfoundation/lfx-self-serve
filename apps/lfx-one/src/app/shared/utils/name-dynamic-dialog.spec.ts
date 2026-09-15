// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { providePrimeNG } from 'primeng/config';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, describe, expect, it } from 'vitest';

import { nameDynamicDialog } from './name-dynamic-dialog';

const HEADING_ID = 'named-dialog-heading';

@Component({
  selector: 'lfx-named-heading-stub',
  template: `<h2 [id]="headingId">Create Meeting</h2>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class NamedHeadingStub {
  protected readonly headingId = HEADING_ID;
}

describe('nameDynamicDialog', () => {
  let dialogRef: DynamicDialogRef | null = null;

  afterEach(() => {
    dialogRef?.destroy();
    dialogRef = null;
  });

  it('sets aria-labelledby on the role=dialog node to the body heading', async () => {
    await TestBed.configureTestingModule({
      providers: [provideNoopAnimations(), providePrimeNG({}), DialogService],
    }).compileComponents();

    const dialogService = TestBed.inject(DialogService);
    dialogRef = dialogService.open(NamedHeadingStub, {
      showHeader: false,
      modal: true,
      closable: false,
    });

    expect(dialogRef).not.toBeNull();
    nameDynamicDialog(dialogService, dialogRef as DynamicDialogRef, HEADING_ID);

    const dialog = document.querySelector('[role="dialog"]');
    const heading = document.getElementById(HEADING_ID);
    expect(heading?.textContent).toBe('Create Meeting');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(HEADING_ID);
  });
});
