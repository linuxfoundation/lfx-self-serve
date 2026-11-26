// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DOCUMENT_ROOT_FOLDER_VALUE } from '@lfx-one/shared/constants';
import { DocumentUpdateDialogData } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectService } from '@services/project.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentUpdateDialogComponent } from './document-update-dialog.component';

const FOLDER = '3f2a8c1e-5b7d-4e69-9a0f-1c2d3e4f5a6b';

const baseData: DocumentUpdateDialogData = {
  mode: 'rename',
  entityType: 'committee',
  entityId: 'c-1',
  documentUid: 'd-1',
  documentType: 'link',
  name: 'Charter',
  parentUid: null,
  folders: [{ label: 'Reports', value: FOLDER }],
};

// State only: validity, the computed change and the calls are asserted without rendering a template (see .claude/rules/unit-test-cost.md).
@Component({ selector: 'lfx-document-update-dialog-state', template: '' })
class DocumentUpdateDialogStateComponent extends DocumentUpdateDialogComponent {}

describe('DocumentUpdateDialogComponent', () => {
  const close = vi.fn();
  const updateCommitteeDocument = vi.fn();
  const updateProjectDocument = vi.fn();

  let config: { data: DocumentUpdateDialogData; closable?: boolean };

  function create(data: Partial<DocumentUpdateDialogData> = {}) {
    config = { data: { ...baseData, ...data } };
    TestBed.configureTestingModule({
      imports: [DocumentUpdateDialogStateComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogConfig, useValue: config },
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: CommitteeService, useValue: { updateCommitteeDocument } },
        { provide: ProjectService, useValue: { updateProjectDocument } },
      ],
    });
    const fixture = TestBed.createComponent(DocumentUpdateDialogStateComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    close.mockReset();
    updateCommitteeDocument.mockReset().mockReturnValue(of({ id: 'd-1' }));
    updateProjectDocument.mockReset().mockReturnValue(of({ uid: 'd-1' }));
  });

  it('has nothing to save until the name differs', () => {
    const cmp = create();
    expect(cmp.unchanged()).toBe(true);

    cmp.form.controls.name.setValue('  Charter  ');
    expect(cmp.unchanged()).toBe(true);

    cmp.form.controls.name.setValue('Bylaws');
    expect(cmp.changes()).toEqual({ name: 'Bylaws' });
  });

  it('refuses a blank name and one over the limit for the type', () => {
    const cmp = create({ documentType: 'folder' });

    cmp.form.controls.name.setValue('   ');
    expect(cmp.form.invalid).toBe(true);

    cmp.form.controls.name.setValue('x'.repeat(201));
    expect(cmp.form.invalid).toBe(true);
    expect(cmp.nameMaxLength).toBe(200);
  });

  it('renames a group document and closes with the result', () => {
    const cmp = create();
    cmp.form.controls.name.setValue('Bylaws');
    cmp.onSubmit();

    expect(updateCommitteeDocument).toHaveBeenCalledWith('c-1', 'd-1', 'link', { name: 'Bylaws' });
    expect(close).toHaveBeenCalledWith({ id: 'd-1' });
  });

  it('sends a project document through the project service', () => {
    const cmp = create({ entityType: 'project', entityId: 'p-1' });
    cmp.form.controls.name.setValue('Bylaws');
    cmp.onSubmit();

    expect(updateProjectDocument).toHaveBeenCalledWith('p-1', 'd-1', 'link', { name: 'Bylaws' });
    expect(updateCommitteeDocument).not.toHaveBeenCalled();
  });

  it('moves into a folder', () => {
    const cmp = create({ mode: 'move' });
    expect(cmp.unchanged()).toBe(true);
    expect(cmp.folderOptions[0].value).toBe(DOCUMENT_ROOT_FOLDER_VALUE);

    cmp.form.controls.parent_uid.setValue(FOLDER);
    expect(cmp.changes()).toEqual({ parent_uid: FOLDER });
  });

  it('moves a document whose current name would fail the rename rules', () => {
    const cmp = create({ mode: 'move', name: 'x'.repeat(600) });
    cmp.form.controls.parent_uid.setValue(FOLDER);
    cmp.onSubmit();

    expect(updateCommitteeDocument).toHaveBeenCalledWith('c-1', 'd-1', 'link', { parent_uid: FOLDER });
  });

  it('moves to the root as a null parent', () => {
    const cmp = create({ mode: 'move', parentUid: FOLDER });
    cmp.form.controls.parent_uid.setValue(DOCUMENT_ROOT_FOLDER_VALUE);
    cmp.onSubmit();

    expect(updateCommitteeDocument).toHaveBeenCalledWith('c-1', 'd-1', 'link', { parent_uid: null });
  });

  it('cannot be closed from the header while the save is in flight', () => {
    const pending = new Subject<unknown>();
    updateCommitteeDocument.mockReturnValue(pending);
    const cmp = create();
    cmp.form.controls.name.setValue('Bylaws');
    cmp.onSubmit();
    TestBed.tick();

    expect(config.closable).toBe(false);

    pending.next({ id: 'd-1' });
    pending.complete();
    TestBed.tick();

    expect(config.closable).toBe(true);
  });

  it('shows the server message and stays open on a failure', () => {
    updateCommitteeDocument.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'A document with this name already exists' } }))
    );
    const cmp = create();
    cmp.form.controls.name.setValue('Bylaws');
    cmp.onSubmit();

    expect(cmp.errorMessage()).toBe('A document with this name already exists');
    expect(cmp.submitting()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it('does not send when nothing changed', () => {
    const cmp = create();
    cmp.onSubmit();

    expect(updateCommitteeDocument).not.toHaveBeenCalled();
  });
});
