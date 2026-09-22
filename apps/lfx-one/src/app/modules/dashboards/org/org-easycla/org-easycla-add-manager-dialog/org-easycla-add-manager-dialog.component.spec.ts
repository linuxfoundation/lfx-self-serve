// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaAddManagerDialogComponent } from './org-easycla-add-manager-dialog.component';

describe('OrgEasyclaAddManagerDialogComponent', () => {
  const closeDialog = vi.fn();

  async function render(): Promise<ComponentFixture<OrgEasyclaAddManagerDialogComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaAddManagerDialogComponent],
      providers: [provideNoopAnimations(), { provide: DynamicDialogConfig, useValue: {} }, { provide: DynamicDialogRef, useValue: { close: closeDialog } }],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaAddManagerDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  function click(fixture: ComponentFixture<unknown>, testId: string): void {
    const button = fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement | null;
    button?.click();
    fixture.detectChanges();
  }

  function closedWith(): unknown {
    return closeDialog.mock.calls.at(-1)?.[0];
  }

  beforeEach(() => {
    closeDialog.mockReset();
  });

  it('closes with undefined on Cancel', async () => {
    const fixture = await render();

    click(fixture, 'org-easycla-add-manager-cancel');

    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(closedWith()).toBeUndefined();
  });

  it('does not close with a request when submit is invalid', async () => {
    const fixture = await render();

    click(fixture, 'org-easycla-add-manager-submit');

    expect(closeDialog).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-add-manager-first-name-error"]')).toBeTruthy();
  });

  it('closes with a trimmed OrgClaManagerAddRequest on valid submit', async () => {
    const fixture = await render();
    fixture.componentInstance['form'].setValue({
      firstName: '  Ada  ',
      lastName: '  Lovelace  ',
      email: '  contributor@example.org  ',
    });
    fixture.detectChanges();

    click(fixture, 'org-easycla-add-manager-submit');

    expect(closedWith()).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'contributor@example.org',
    });
  });
});
