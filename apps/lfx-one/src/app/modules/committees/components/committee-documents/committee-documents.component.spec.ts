// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { DocumentsTableComponent } from '@components/documents-table/documents-table.component';
import { DOCUMENT_FOLDER_NOT_EMPTY_MESSAGE } from '@lfx-one/shared/constants';
import { Committee, CommitteeDocument, MyDocumentItem } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { DocumentService } from '@services/document.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeDocumentsComponent } from './committee-documents.component';

const committeeDocument = (overrides: Partial<CommitteeDocument>): CommitteeDocument => ({
  uid: 'doc-1',
  type: 'link',
  name: 'Doc',
  created_at: '2026-10-01',
  committee_uid: 'group-1',
  ...overrides,
});

describe('CommitteeDocumentsComponent', () => {
  let fixture: ComponentFixture<CommitteeDocumentsComponent>;
  let committeeDocuments: CommitteeDocument[];
  let relatedDocuments: MyDocumentItem[];
  let getCommitteeDocuments: Mock;
  let deleteCommitteeDocument: Mock;
  let messageService: { add: Mock };

  async function render(canEdit = true): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CommitteeDocumentsComponent],
      providers: [
        provideRouter([]),
        { provide: CommitteeService, useValue: { getCommitteeDocuments, deleteCommitteeDocument } },
        { provide: DocumentService, useValue: { getMyDocuments: vi.fn(() => of(relatedDocuments)) } },
        { provide: MessageService, useValue: messageService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeDocumentsComponent);
    fixture.componentRef.setInput('committee', { uid: 'group-1', name: 'Technical Steering Committee' } as Committee);
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const table = (): DocumentsTableComponent => fixture.debugElement.query(By.directive(DocumentsTableComponent)).componentInstance;
  const rowFor = (id: string): MyDocumentItem => fixture.componentInstance['filteredDocuments']().find((doc) => doc.id === id)!;

  beforeEach(() => {
    committeeDocuments = [
      committeeDocument({ uid: 'link-1', type: 'link', name: 'Roadmap', url: 'https://example.com' }),
      committeeDocument({ uid: 'file-1', type: 'file', name: 'Minutes.pdf', mime_type: 'application/pdf' }),
      committeeDocument({ uid: 'folder-1', type: 'folder', name: 'Archive' }),
    ];
    relatedDocuments = [
      {
        id: 'meeting_file:attachment-1',
        name: 'Agenda.pdf',
        source: 'file',
        foundationName: '',
        groupOrMeetingName: 'Weekly sync',
        groupOrMeetingUid: 'm-1',
        date: '2026-09-01',
      },
    ];
    getCommitteeDocuments = vi.fn(() => of(committeeDocuments));
    deleteCommitteeDocument = vi.fn(() => of(undefined));
    messageService = { add: vi.fn() };
  });

  it('offers row actions on the group’s own folders, links and files, but not on meeting or mailing list documents', async () => {
    await render();

    expect(rowFor('committee_link:link-1').manageableType).toBe('link');
    expect(rowFor('committee_file:file-1').manageableType).toBe('file');
    expect(rowFor('committee_folder:folder-1').manageableType).toBe('folder');
    expect(rowFor('meeting_file:attachment-1').manageableType).toBeUndefined();
  });

  it('lets a group writer manage and a viewer not', async () => {
    await render(true);
    expect(table().canManage()).toBe(true);

    TestBed.resetTestingModule();
    await render(false);
    expect(table().canManage()).toBe(false);
  });

  it.each([
    ['committee_link:link-1', 'link-1', 'link'],
    ['committee_file:file-1', 'file-1', 'file'],
    ['committee_folder:folder-1', 'folder-1', 'folder'],
  ])('deletes %s through the group API, says so, and reloads the list', async (rowId, documentUid, type) => {
    await render();
    let changed = 0;
    fixture.componentInstance.documentsChanged.subscribe(() => changed++);
    expect(getCommitteeDocuments).toHaveBeenCalledTimes(1);

    table().documentDelete.emit(rowFor(rowId));
    await fixture.whenStable();

    expect(deleteCommitteeDocument).toHaveBeenCalledWith('group-1', documentUid, type);
    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Deleted' }));
    expect(getCommitteeDocuments).toHaveBeenCalledTimes(2);
    expect(changed).toBe(1);
  });

  it('shows the server’s reason and leaves the list alone when the delete fails', async () => {
    deleteCommitteeDocument.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: DOCUMENT_FOLDER_NOT_EMPTY_MESSAGE, code: 'FOLDER_NOT_EMPTY' } }))
    );
    await render();
    let changed = 0;
    fixture.componentInstance.documentsChanged.subscribe(() => changed++);

    table().documentDelete.emit(rowFor('committee_folder:folder-1'));
    await fixture.whenStable();

    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: DOCUMENT_FOLDER_NOT_EMPTY_MESSAGE }));
    expect(getCommitteeDocuments).toHaveBeenCalledTimes(1);
    expect(changed).toBe(0);
  });

  it('ignores a row the group cannot manage', async () => {
    await render();

    table().documentDelete.emit(rowFor('meeting_file:attachment-1'));
    await fixture.whenStable();

    expect(deleteCommitteeDocument).not.toHaveBeenCalled();
  });
});
