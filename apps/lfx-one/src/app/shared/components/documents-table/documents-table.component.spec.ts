// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyDocumentItem } from '@lfx-one/shared/interfaces';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it } from 'vitest';

import { DocumentsTableComponent } from './documents-table.component';

const doc = (overrides: Partial<MyDocumentItem>): MyDocumentItem => ({
  id: 'doc-1',
  name: 'Doc',
  source: 'project',
  foundationName: '',
  groupOrMeetingName: '',
  groupOrMeetingUid: '',
  date: '2026-01-01',
  ...overrides,
});

describe('DocumentsTableComponent actions', () => {
  let fixture: ComponentFixture<DocumentsTableComponent>;

  async function render(item: MyDocumentItem): Promise<HTMLElement> {
    fixture.componentRef.setInput('documents', [item]);
    fixture.componentRef.setInput('showFoundation', false);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentsTableComponent],
      providers: [{ provide: DialogService, useValue: { open: () => null } }],
    }).compileComponents();
    fixture = TestBed.createComponent(DocumentsTableComponent);
  });

  it('offers Download for a project file', async () => {
    const el = await render(doc({ documentKind: 'file', downloadUrl: '/api/projects/p/documents/d/download', attachmentUid: 'd' }));
    expect(el.querySelector('[data-testid="documents-download-doc-1"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="documents-open-doc-1"]')).toBeFalsy();
  });

  it('offers Open link, not Download, for a project link', async () => {
    const el = await render(doc({ documentKind: 'link', url: 'https://example.com' }));
    expect(el.querySelector('[data-testid="documents-open-doc-1"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="documents-download-doc-1"]')).toBeFalsy();
  });

  it('offers Open link for a meeting attachment that is a link', async () => {
    const el = await render(doc({ source: 'meeting', documentKind: 'link', url: 'https://example.com' }));
    expect(el.querySelector('[data-testid="documents-open-doc-1"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="documents-download-doc-1"]')).toBeFalsy();
  });

  it('still offers Download for a meeting attachment that is a file', async () => {
    const el = await render(doc({ source: 'meeting', documentKind: 'file', url: 'https://example.com/f.pdf' }));
    expect(el.querySelector('[data-testid="documents-download-doc-1"]')).toBeTruthy();
  });
});
