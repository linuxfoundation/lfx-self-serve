// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyDocumentItem } from '@lfx-one/shared/interfaces';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';
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
      providers: [provideRouter([]), { provide: DialogService, useValue: { open: () => null } }],
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

  describe('the group / meeting / mailing list name', () => {
    const link = (el: HTMLElement): HTMLAnchorElement | null => el.querySelector('[data-testid="documents-source-link-doc-1"]');

    it('links a group document to the group details page', async () => {
      const el = await render(doc({ source: 'link', groupOrMeetingName: 'Technical Steering Committee', groupOrMeetingUid: 'group-1' }));

      expect(link(el)?.textContent?.trim()).toBe('Technical Steering Committee');
      expect(link(el)?.getAttribute('href')).toBe('/groups/group-1');
    });

    it('links an upcoming meeting document to the meeting page and a past one to its details', async () => {
      let el = await render(doc({ source: 'meeting', groupOrMeetingName: 'Weekly sync', groupOrMeetingUid: 'm-1', meetingId: 'm-1' }));
      expect(link(el)?.getAttribute('href')).toBe('/meetings/m-1');

      fixture = TestBed.createComponent(DocumentsTableComponent);
      el = await render(doc({ source: 'recording', groupOrMeetingName: 'Weekly sync', groupOrMeetingUid: 'occ-1', pastMeetingId: 'occ-1' }));
      expect(link(el)?.getAttribute('href')).toBe('/meetings/occ-1/details');
    });

    it('links a mailing list document to the list, not the group it is linked to', async () => {
      const el = await render(
        doc({ source: 'mailing_list', groupOrMeetingName: 'Maintainers', groupOrMeetingUid: 'group-1', mailingListId: '154980', mailingListUid: 'list-7' })
      );

      expect(link(el)?.getAttribute('href')).toBe('/mailing-lists/list-7');
    });

    it('shows a dash, not a link, for a row with no name', async () => {
      const el = await render(doc({ source: 'mailing_list', groupOrMeetingName: '', groupOrMeetingUid: 'group-1' }));

      expect(link(el)).toBeNull();
      expect(el.querySelector('[data-testid="documents-row-doc-1"]')?.textContent).toContain('—');
    });

    it('shows the group whose own Documents tab it is as plain text', async () => {
      fixture.componentRef.setInput('currentGroupUid', 'group-1');
      const el = await render(doc({ source: 'link', groupOrMeetingName: 'Technical Steering Committee', groupOrMeetingUid: 'group-1' }));

      expect(link(el)).toBeNull();
      expect(el.textContent).toContain('Technical Steering Committee');
    });

    it('passes the back state to group links only', async () => {
      const state = { backLabel: 'Documents', backPath: '/documents', fromMeLens: true };
      fixture.componentRef.setInput('groupLinkState', state);
      await render(doc({ source: 'link', groupOrMeetingName: 'Technical Steering Committee', groupOrMeetingUid: 'group-1' }));
      expect(fixture.debugElement.query(By.directive(RouterLink)).injector.get(RouterLink).state).toEqual(state);

      fixture = TestBed.createComponent(DocumentsTableComponent);
      fixture.componentRef.setInput('groupLinkState', state);
      await render(doc({ source: 'meeting', groupOrMeetingName: 'Weekly sync', groupOrMeetingUid: 'm-1', meetingId: 'm-1' }));
      expect(fixture.debugElement.query(By.css('[data-testid="documents-source-link-doc-1"]')).injector.get(RouterLink).state).toBeUndefined();
    });
  });
});
