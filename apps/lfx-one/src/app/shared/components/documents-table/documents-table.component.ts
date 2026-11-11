// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SummaryModalComponent } from '@components/summary-modal/summary-modal.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { DOCUMENT_FOLDER_NOT_EMPTY_MESSAGE } from '@lfx-one/shared/constants';
import { GroupLinkState, MyDocumentItem, MyDocumentTableRow } from '@lfx-one/shared/interfaces';
import { getDocumentSourceLink } from '@lfx-one/shared/utils';
import { DocumentDisplayNamePipe } from '@app/shared/pipes/document-display-name.pipe';
import { DocumentKindTagPipe } from '@app/shared/pipes/document-kind-tag.pipe';
import { MyDocumentSourceTagPipe } from '@app/shared/pipes/my-document-source-tag.pipe';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-documents-table',
  imports: [
    TableComponent,
    TagComponent,
    ButtonComponent,
    DatePipe,
    MyDocumentSourceTagPipe,
    DocumentKindTagPipe,
    DocumentDisplayNamePipe,
    TooltipModule,
    RouterLink,
    MenuComponent,
    ConfirmDialogModule,
  ],
  // NOTE: MessageService is deliberately not provided here: a single root instance must back the global <p-toast />.
  providers: [DialogService, ConfirmationService],
  templateUrl: './documents-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsTableComponent {
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  public readonly documents = input<MyDocumentItem[]>([]);
  public readonly loading = input<boolean>(false);
  public readonly showFoundation = input<boolean>(true);
  public readonly testIdPrefix = input<string>('documents');
  public readonly emptyMessage = input<string>('No documents found');
  // The group whose own Documents tab this is; its name is plain text instead of a link to the page the user is already on.
  public readonly currentGroupUid = input<string>('');
  // Navigation state for group links, so the group page returns to the documents page. Meeting and mailing list pages take none.
  public readonly groupLinkState = input<GroupLinkState | null>(null);

  // Whether the viewer may change the documents shown. Rows still need `manageableType` set by the page to get actions.
  public readonly canManage = input<boolean>(false);

  /** Emitted when a row with `isFolder: true` is clicked. Consumers use this to drill into the folder. */
  public readonly folderOpen = output<MyDocumentItem>();
  /** Emitted after the user confirms deleting a manageable row. The page makes the API call and refreshes. */
  public readonly documentDelete = output<MyDocumentItem>();

  protected readonly colSpan = computed(() => (this.showFoundation() ? 7 : 6));
  protected readonly hasDocuments = computed(() => this.documents().length > 0);
  protected readonly rows: Signal<MyDocumentTableRow[]> = this.initRows();
  /** Each manageable row's own menu items, keyed by row id, so a menu can only ever act on the row it belongs to. */
  protected readonly manageMenus: Signal<Map<string, MenuItem[]>> = this.initManageMenus();
  // Widen the Actions column (and narrow Name by the same amount) only when a row can show the extra menu button.
  protected readonly nameColumnClass = computed(() => {
    if (this.showFoundation()) return this.canManage() ? 'w-[24%]' : 'w-[28%]';
    return this.canManage() ? 'w-[36%]' : 'w-[40%]';
  });
  protected readonly actionsColumnClass = computed(() => (this.canManage() ? 'w-[9%]' : 'w-[5%]'));

  // The click is left to bubble: PrimeNG closes an open popup from its document click listener, so stopping it here
  // would leave another row's menu open when this one opens.
  protected toggleManageMenu(event: Event, menu: MenuComponent): void {
    menu.toggle(event);
  }

  protected onFolderClick(doc: MyDocumentItem): void {
    this.folderOpen.emit(doc);
  }

  protected openDocument(doc: MyDocumentItem): void {
    if (!doc.url) return;
    try {
      const url = new URL(doc.url);
      if (['http:', 'https:'].includes(url.protocol)) {
        window.open(doc.url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      // Invalid URL — silently ignore
    }
  }

  protected previewSummary(doc: MyDocumentItem): void {
    this.dialogService.open(SummaryModalComponent, {
      width: '700px',
      modal: true,
      draggable: false,
      resizable: false,
      data: {
        summaryUid: doc.summaryUid,
        pastMeetingUid: doc.groupOrMeetingUid,
        meetingTitle: doc.groupOrMeetingName,
        summaryContent: doc.summaryContent ?? '',
        approved: false,
        readOnly: true,
      },
    });
  }

  protected downloadDocument(doc: MyDocumentItem): void {
    // BFF URL: let server Content-Disposition control the filename.
    const useBffDownload = !!doc.downloadUrl;
    const targetUrl =
      doc.downloadUrl ?? (doc.url ? `/api/documents/download?url=${encodeURIComponent(doc.url)}&filename=${encodeURIComponent(doc.name || 'download')}` : null);
    if (!targetUrl) return;
    const a = document.createElement('a');
    a.href = targetUrl;
    // Proxy path falls back to display name — original filename may not be recoverable.
    if (!useBffDownload) {
      a.download = doc.name || 'download';
    }
    a.click();
  }

  private initRows(): Signal<MyDocumentTableRow[]> {
    return computed(() => this.documents().map((doc) => ({ ...doc, sourceLink: getDocumentSourceLink(doc, this.currentGroupUid()) })));
  }

  private initManageMenus(): Signal<Map<string, MenuItem[]>> {
    return computed(() => {
      const menus = new Map<string, MenuItem[]>();
      for (const doc of this.documents()) {
        if (!doc.manageableType) continue;
        menus.set(doc.id, [
          {
            label: 'Delete',
            icon: 'fa-light fa-trash',
            styleClass: 'text-red-600',
            command: () => this.onDeleteClick(doc),
          },
        ]);
      }
      return menus;
    });
  }

  private onDeleteClick(doc: MyDocumentItem): void {
    if (!doc.manageableType) return;

    // A folder with documents in it is never deleted: say what to do instead. The BFF enforces this too.
    if (doc.isFolder && (doc.childCount ?? 0) > 0) {
      this.messageService.add({ severity: 'warn', summary: 'Folder not empty', detail: DOCUMENT_FOLDER_NOT_EMPTY_MESSAGE });
      return;
    }

    this.confirmationService.confirm({
      header: `Delete ${doc.manageableType}`,
      message: `Delete "${doc.name}"? This can't be undone.`,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm',
      accept: () => this.documentDelete.emit(doc),
    });
  }
}
