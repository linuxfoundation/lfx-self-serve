// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import type { Project } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProjectApplicationAcceptDialogComponent } from './project-application-accept-dialog.component';

interface DialogAccess {
  search: (event: { query: string }) => void;
  suggestions: () => Project[];
  onSelected: (event: { value: Project }) => void;
  onCleared: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const PARENT = { uid: 'parent-uid', name: 'Parent', slug: 'parent' } as Project;

describe('ProjectApplicationAcceptDialogComponent (#3037)', () => {
  const setup = async () => {
    const close = vi.fn();
    const searchProjects = vi.fn(() => of([PARENT, { uid: '', name: 'No uid', slug: 'none' } as Project]));
    await TestBed.configureTestingModule({
      imports: [ProjectApplicationAcceptDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { projectName: 'Example' } } },
        { provide: ProjectService, useValue: { searchProjects } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProjectApplicationAcceptDialogComponent);
    fixture.detectChanges();
    return { component: fixture.componentInstance as unknown as DialogAccess, close, searchProjects };
  };

  it('searches only from two characters and drops results without a uid', async () => {
    const { component, searchProjects } = await setup();
    component.search({ query: 'p' });
    expect(searchProjects).not.toHaveBeenCalled();
    component.search({ query: 'pa' });
    expect(component.suggestions()).toEqual([PARENT]);
  });

  it('closes with the chosen parent only after one is selected', async () => {
    const { component, close } = await setup();
    component.onConfirm();
    expect(close).not.toHaveBeenCalled();

    component.onSelected({ value: PARENT });
    component.onConfirm();
    expect(close).toHaveBeenCalledWith(PARENT);
  });

  it('typing after a selection clears it, so Confirm cannot send a parent the field no longer shows', async () => {
    const { component, close } = await setup();
    component.onSelected({ value: PARENT });
    (component as unknown as { form: { controls: { parent: { setValue: (v: string) => void } } } }).form.controls.parent.setValue('Other');
    component.onConfirm();
    expect(close).not.toHaveBeenCalled();
  });

  it('clearing the selection blocks confirm again, and cancel closes empty', async () => {
    const { component, close } = await setup();
    component.onSelected({ value: PARENT });
    component.onCleared();
    component.onConfirm();
    expect(close).not.toHaveBeenCalled();
    component.onCancel();
    expect(close).toHaveBeenCalledWith();
  });
});
