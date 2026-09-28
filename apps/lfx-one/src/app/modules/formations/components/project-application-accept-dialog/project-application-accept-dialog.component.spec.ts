// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import type { Project } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, Subject } from 'rxjs';
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

describe('ProjectApplicationAcceptDialogComponent (#3037, #1995)', () => {
  const setup = async (projectName = 'Example Project', projectSlug?: string) => {
    TestBed.resetTestingModule();
    const close = vi.fn();
    const searchProjects = vi.fn<(query: string) => Observable<Project[]>>(() => of([PARENT, { uid: '', name: 'No uid', slug: 'none' } as Project]));
    await TestBed.configureTestingModule({
      imports: [ProjectApplicationAcceptDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { projectName, projectSlug } } },
        { provide: ProjectService, useValue: { searchProjects } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProjectApplicationAcceptDialogComponent);
    fixture.detectChanges();
    return { component: fixture.componentInstance as unknown as DialogAccess, form: fixture.componentInstance.form, close, searchProjects };
  };

  it('searches only from two characters and drops results without a uid', async () => {
    const { component, searchProjects } = await setup();
    component.search({ query: 'p' });
    expect(searchProjects).not.toHaveBeenCalled();
    component.search({ query: 'pa' });
    expect(component.suggestions()).toEqual([PARENT]);
  });

  it('drops a superseded search, so a slow older response cannot replace newer results', async () => {
    const { component, searchProjects } = await setup();
    const older = new Subject<Project[]>();
    const newer = new Subject<Project[]>();
    searchProjects.mockReturnValueOnce(older).mockReturnValueOnce(newer);

    component.search({ query: 'pa' });
    component.search({ query: 'par' });
    newer.next([PARENT]);
    older.next([{ uid: 'stale-uid', name: 'Stale', slug: 'stale' } as Project]);

    expect(component.suggestions()).toEqual([PARENT]);
  });

  it('closes with the chosen parent only after one is selected', async () => {
    const { component, form, close } = await setup();
    component.onConfirm();
    expect(close).not.toHaveBeenCalled();

    form.controls.parent.setValue(PARENT);
    component.onSelected({ value: PARENT });
    component.onConfirm();
    expect(close).toHaveBeenCalledWith({ parent: PARENT, slug: 'example-project' });
  });

  it('an unmatched entry blurring to null (forceSelection) clears the choice, so Confirm sends nothing', async () => {
    const { component, form, close } = await setup();
    form.controls.parent.setValue(PARENT);
    component.onSelected({ value: PARENT });
    // What PrimeNG writes on blur when the typed text matches no suggestion under forceSelection.
    form.controls.parent.setValue(null);
    component.onConfirm();
    expect(close).not.toHaveBeenCalled();
  });

  it('confirms with the project the field holds', async () => {
    const { component, form, close } = await setup();
    form.controls.parent.setValue(PARENT);
    component.onConfirm();
    expect(close).toHaveBeenCalledWith({ parent: PARENT, slug: 'example-project' });
  });

  it('prefills the slug from the proposed project name', async () => {
    const { form } = await setup('LFX One');
    expect(form.controls.slug.value).toBe('lfx-one');
  });

  it('prefills the slug an earlier accept recorded, so a retry keeps the project that may already exist', async () => {
    const { form } = await setup('LFX One', 'lfx-one-v2');
    expect(form.controls.slug.value).toBe('lfx-one-v2');
  });

  it('blocks confirm on an invalid or empty slug, and closes with the edited slug once valid', async () => {
    const { component, form, close } = await setup();
    form.controls.parent.setValue(PARENT);
    form.controls.slug.setValue('Not Valid');
    component.onConfirm();
    form.controls.slug.setValue('');
    component.onConfirm();
    expect(close).not.toHaveBeenCalled();

    form.controls.slug.setValue('my_project-2');
    component.onConfirm();
    expect(close).toHaveBeenCalledWith({ parent: PARENT, slug: 'my_project-2' });
  });

  it('clearing the selection blocks confirm again, and cancel closes empty', async () => {
    const { component, form, close } = await setup();
    form.controls.parent.setValue(PARENT);
    form.controls.parent.setValue(null);
    component.onCleared();
    component.onConfirm();
    expect(close).not.toHaveBeenCalled();
    component.onCancel();
    expect(close).toHaveBeenCalledWith();
  });
});
