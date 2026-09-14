// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import { ChangelogService } from '@services/changelog.service';
import { CreatePermissionService } from '@services/create-permission.service';
import { LensService } from '@services/lens.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CreateArtifactDialogComponent } from '@components/create-artifact-dialog/create-artifact-dialog.component';

import { LensSwitcherComponent } from './lens-switcher.component';

describe('LensSwitcherComponent create dialog', () => {
  const openDialog = vi.fn();
  const setDialogPt = vi.fn();

  async function render(): Promise<ComponentFixture<LensSwitcherComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LensSwitcherComponent],
      providers: [
        provideRouter([]),
        { provide: LensService, useValue: { displayLenses: signal([]), displayActiveLens: signal('me'), switchLens: vi.fn(), setLens: vi.fn() } },
        {
          provide: UserService,
          useValue: {
            user: signal(null),
            effectiveAvatarUrl: signal(null),
            userInitials: signal(''),
            canImpersonate: signal(false),
            impersonating: signal(false),
          },
        },
        { provide: ChangelogService, useValue: { unseenChangelogCount: signal(0), loadUnseenCount: vi.fn() } },
        {
          provide: CreatePermissionService,
          useValue: { creatableTypes: signal(CREATABLE_ARTIFACTS.map((artifact) => artifact.type)), canShowCreateButton: signal(true) },
        },
      ],
    })
      .overrideComponent(LensSwitcherComponent, {
        set: {
          providers: [
            {
              provide: DialogService,
              useValue: {
                open: openDialog,
                dialogComponentRefMap: { get: () => ({ setInput: setDialogPt, changeDetectorRef: { detectChanges: vi.fn() } }) },
              },
            },
          ],
        },
      })
      .compileComponents();

    openDialog.mockReturnValue({ onClose: of(null), onDestroy: of(undefined), close: vi.fn() });
    const fixture = TestBed.createComponent(LensSwitcherComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('names the create dialog through DynamicDialog pt rather than the inert ariaLabelledBy config', async () => {
    const fixture = await render();
    const artifact = CREATABLE_ARTIFACTS[0];

    fixture.componentInstance['openCreateDialog'](artifact);

    expect(openDialog).toHaveBeenCalledWith(
      CreateArtifactDialogComponent,
      expect.objectContaining({
        showHeader: false,
        data: { type: artifact.type },
      })
    );
    expect(openDialog.mock.calls[0][1].ariaLabelledBy).toBeUndefined();
    expect(setDialogPt).toHaveBeenCalledWith('pt', {
      pcDialog: { root: { 'aria-labelledby': CreateArtifactDialogComponent.headingId } },
    });
  });
});
