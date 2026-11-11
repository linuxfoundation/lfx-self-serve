// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyDocumentItem } from '@lfx-one/shared/interfaces';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      providers: [provideRouter([]), { provide: DialogService, useValue: { open: () => null } }, MessageService],
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

describe('DocumentsTableComponent row actions menu', () => {
  let fixture: ComponentFixture<DocumentsTableComponent>;
  let messageService: { add: ReturnType<typeof vi.fn> };
  let deleted: MyDocumentItem[];

  const actionsButton = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('[data-testid="documents-actions-doc-1"] button, button[data-testid="documents-actions-doc-1"]');
  const body = (): HTMLElement => document.body;

  async function render(item: MyDocumentItem, canManage = true): Promise<void> {
    fixture.componentRef.setInput('documents', [item]);
    fixture.componentRef.setInput('showFoundation', false);
    fixture.componentRef.setInput('canManage', canManage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** Opens the row's menu and clicks Delete. */
  async function clickDelete(): Promise<void> {
    actionsButton()?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const item = Array.from(body().querySelectorAll<HTMLElement>('.p-menu-item-link, [role="menuitem"] a')).find((el) => el.textContent?.includes('Delete'));
    item?.click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const confirmButton = (kind: 'accept' | 'reject'): HTMLElement | null =>
    body().querySelector(
      kind === 'accept' ? '.p-confirmdialog-accept-button, .p-confirm-dialog-accept' : '.p-confirmdialog-reject-button, .p-confirm-dialog-reject'
    );

  beforeEach(async () => {
    messageService = { add: vi.fn() };
    deleted = [];
    await TestBed.configureTestingModule({
      imports: [DocumentsTableComponent],
      // The row menu is a PrimeNG overlay, which needs animations configured to open.
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: DialogService, useValue: { open: () => null } },
        { provide: MessageService, useValue: messageService },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DocumentsTableComponent);
    fixture.componentInstance.documentDelete.subscribe((item) => deleted.push(item));
  });

  it('shows the actions button on a manageable row when the viewer can manage', async () => {
    await render(doc({ manageableType: 'link', url: 'https://example.com' }));

    expect(actionsButton()).toBeTruthy();
  });

  it('shows no actions button when the viewer cannot manage', async () => {
    await render(doc({ manageableType: 'link', url: 'https://example.com' }), false);

    expect(fixture.nativeElement.querySelector('[data-testid="documents-actions-doc-1"]')).toBeNull();
  });

  it('shows no actions button on a row the page cannot manage, such as a meeting document', async () => {
    await render(doc({ source: 'meeting', documentKind: 'file', url: 'https://example.com/f.pdf' }));

    expect(fixture.nativeElement.querySelector('[data-testid="documents-actions-doc-1"]')).toBeNull();
  });

  it('asks for confirmation, then emits the row once confirmed', async () => {
    await render(doc({ manageableType: 'link', name: 'Roadmap', url: 'https://example.com' }));

    await clickDelete();

    expect(body().textContent).toContain('Delete "Roadmap"?');
    expect(deleted).toEqual([]);

    confirmButton('accept')?.click();
    fixture.detectChanges();

    expect(deleted.map((row) => row.id)).toEqual(['doc-1']);
  });

  it('emits nothing when the confirmation is cancelled', async () => {
    await render(doc({ manageableType: 'file', name: 'Minutes.pdf', downloadUrl: '/api/x/download', attachmentUid: 'd' }));

    await clickDelete();
    confirmButton('reject')?.click();
    fixture.detectChanges();

    expect(deleted).toEqual([]);
  });

  it('refuses to delete a folder that still has documents and says what to do instead', async () => {
    await render(doc({ manageableType: 'folder', isFolder: true, childCount: 2, name: 'Archive' }));

    await clickDelete();

    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', detail: expect.stringContaining('Delete or move them') }));
    expect(confirmButton('accept')).toBeNull();
    expect(deleted).toEqual([]);
  });

  it('lets an empty folder go through the confirmation', async () => {
    await render(doc({ manageableType: 'folder', isFolder: true, childCount: 0, name: 'Archive' }));

    await clickDelete();
    confirmButton('accept')?.click();
    fixture.detectChanges();

    expect(messageService.add).not.toHaveBeenCalled();
    expect(deleted.map((row) => row.id)).toEqual(['doc-1']);
  });

  describe('with two manageable rows', () => {
    const rowButton = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="documents-actions-${id}"] button`);
    const openMenus = (): HTMLElement[] => Array.from(body().querySelectorAll<HTMLElement>('.p-menu-overlay'));

    async function renderTwoRows(): Promise<void> {
      fixture.componentRef.setInput('documents', [
        doc({ id: 'a', name: 'Alpha', manageableType: 'link', url: 'https://a.example' }),
        doc({ id: 'b', name: 'Beta', manageableType: 'link', url: 'https://b.example' }),
      ]);
      fixture.componentRef.setInput('showFoundation', false);
      fixture.componentRef.setInput('canManage', true);
      fixture.detectChanges();
      await fixture.whenStable();
    }

    async function open(id: string): Promise<void> {
      rowButton(id)?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      // PrimeNG emits the menu's show and hide events from its overlay animation callbacks, a tick after the click.
      await new Promise<void>((resolve) => setTimeout(resolve));
      fixture.detectChanges();
    }

    it('closes the first row’s menu when another row’s menu is opened', async () => {
      await renderTwoRows();

      await open('a');
      expect(openMenus()).toHaveLength(1);

      await open('b');
      expect(openMenus()).toHaveLength(1);
    });

    it('reports aria-expanded only on the button whose menu is open', async () => {
      await renderTwoRows();
      const expanded = (id: string): string | null | undefined => rowButton(id)?.getAttribute('aria-expanded');

      expect([expanded('a'), expanded('b')]).toEqual(['false', 'false']);

      await open('a');
      expect([expanded('a'), expanded('b')]).toEqual(['true', 'false']);

      await open('b');
      expect([expanded('a'), expanded('b')]).toEqual(['false', 'true']);
    });

    it('asks about the row whose menu was opened, not the one opened before it', async () => {
      await renderTwoRows();
      await open('a');
      await open('b');

      Array.from(body().querySelectorAll<HTMLElement>('.p-menu-item-link, [role="menuitem"] a'))
        .find((el) => el.textContent?.includes('Delete'))
        ?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(body().textContent).toContain('Delete "Beta"?');
      expect(body().textContent).not.toContain('Delete "Alpha"?');
    });
  });
});
