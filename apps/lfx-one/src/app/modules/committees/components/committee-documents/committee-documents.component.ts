// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { CardComponent } from '@components/card/card.component';
import { ButtonComponent } from '@components/button/button.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FileSizePipe } from '@pipes/file-size.pipe';
import { InputTextModule } from 'primeng/inputtext';
import { Committee, MeetingAttachment } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { catchError, filter, finalize, from, map, mergeMap, of, switchMap, toArray } from 'rxjs';

/** Attachment enriched with meeting context for display. */
interface MeetingAttachmentWithContext {
  attachment: MeetingAttachment;
  meetingTitle: string;
  meetingDate: string;
  meetingId: string;
}

/** Max concurrent attachment fetches to avoid overwhelming the backend. */
const ATTACHMENT_FETCH_CONCURRENCY = 4;

@Component({
  selector: 'lfx-committee-documents',
  imports: [CardComponent, ButtonComponent, TableComponent, TagComponent, FileSizePipe, InputTextModule, DatePipe],
  templateUrl: './committee-documents.component.html',
  styleUrl: './committee-documents.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeDocumentsComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);

  // Inputs
  public committee = input.required<Committee>();

  // State
  public loading = signal<boolean>(true);
  public searchQuery = signal('');

  // Data — fetches attachments from all committee meetings with bounded concurrency
  public allAttachments: Signal<MeetingAttachmentWithContext[]> = this.initAttachments();

  // Filtered by search
  public filteredAttachments: Signal<MeetingAttachmentWithContext[]> = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const all = this.allAttachments();
    if (!query) return all;
    return all.filter((item) => item.attachment.name.toLowerCase().includes(query) || item.meetingTitle.toLowerCase().includes(query));
  });

  /** Typed search input handler — avoids $any() cast in template. */
  public onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  /** Opens attachment — link in new tab, file via download URL. Validates URL protocol to prevent XSS. */
  public openAttachment(item: MeetingAttachmentWithContext): void {
    if (item.attachment.type === 'link' && item.attachment.link) {
      this.openSafeUrl(item.attachment.link);
    } else {
      this.meetingService.getMeetingAttachmentDownloadUrl(item.meetingId, item.attachment.uid).subscribe({
        next: (response) => {
          if (response?.download_url) {
            this.openSafeUrl(response.download_url);
          }
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to get download link.' });
        },
      });
    }
  }

  /** Opens a URL only if it uses http: or https: protocol. */
  private openSafeUrl(rawUrl: string): void {
    try {
      const url = new URL(rawUrl);
      if (['http:', 'https:'].includes(url.protocol)) {
        window.open(rawUrl, '_blank', 'noopener,noreferrer');
      }
    } catch {
      // Invalid URL — silently ignore
    }
  }

  // Private initializer — uses mergeMap with bounded concurrency instead of forkJoin.
  // Note: getMeetingsByCommittee returns up to 100 meetings without pagination.
  // Committee meetings are typically < 20; full pagination (page_token loop) deferred to Phase 2.
  private initAttachments(): Signal<MeetingAttachmentWithContext[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.loading.set(true);
          return this.meetingService.getMeetingsByCommittee(c.uid, 100).pipe(
            switchMap((meetings) => {
              if (meetings.length === 0) return of([]);

              return from(meetings).pipe(
                mergeMap(
                  (meeting) =>
                    this.meetingService.getMeetingAttachments(meeting.id).pipe(
                      catchError(() => of([] as MeetingAttachment[])),
                      map((attachments) =>
                        attachments.map((att) => ({
                          attachment: att,
                          meetingTitle: meeting.title,
                          meetingDate: meeting.start_time,
                          meetingId: meeting.id,
                        }))
                      )
                    ),
                  ATTACHMENT_FETCH_CONCURRENCY
                ),
                toArray(),
                map((results) => results.flat().sort((a, b) => (b.attachment.created_at ?? '').localeCompare(a.attachment.created_at ?? '')))
              );
            }),
            catchError(() => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load documents. Please try again.' });
              return of([]);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
