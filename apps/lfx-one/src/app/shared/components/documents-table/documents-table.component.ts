// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { SummaryModalComponent } from '@components/summary-modal/summary-modal.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyDocumentItem } from '@lfx-one/shared/interfaces';
import { MyDocumentSourceTagPipe } from '@app/shared/pipes/my-document-source-tag.pipe';
import { DialogService } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-documents-table',
  imports: [TableComponent, TagComponent, ButtonComponent, DatePipe, MyDocumentSourceTagPipe, TooltipModule],
  providers: [DialogService],
  templateUrl: './documents-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsTableComponent {
  private readonly dialogService = inject(DialogService);

  public readonly documents = input<MyDocumentItem[]>([]);
  public readonly loading = input<boolean>(false);
  public readonly showFoundation = input<boolean>(true);
  public readonly testIdPrefix = input<string>('documents');
  public readonly emptyMessage = input<string>('No documents found');

  protected readonly colSpan = computed(() => (this.showFoundation() ? 6 : 5));

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
    if (!doc.url) return;
    const proxyUrl = `/api/documents/download?url=${encodeURIComponent(doc.url)}&filename=${encodeURIComponent(doc.name || 'download')}`;
    const a = document.createElement('a');
    a.href = proxyUrl;
    a.download = doc.name || 'download';
    a.click();
  }
}
