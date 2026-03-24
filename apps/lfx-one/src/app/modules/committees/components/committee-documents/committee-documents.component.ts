// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { CardComponent } from '@components/card/card.component';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { Committee, MeetingAttachment } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { catchError, filter, finalize, forkJoin, of, switchMap } from 'rxjs';
import { SkeletonModule } from 'primeng/skeleton';

/** Attachment enriched with meeting context for display. */
interface MeetingAttachmentWithContext {
  attachment: MeetingAttachment;
  meetingTitle: string;
  meetingDate: string;
  meetingId: string;
}

@Component({
  selector: 'lfx-committee-documents',
  imports: [CardComponent, ButtonComponent, TagComponent, InputTextComponent, DatePipe, SkeletonModule],
  templateUrl: './committee-documents.component.html',
  styleUrl: './committee-documents.component.scss',
})
export class CommitteeDocumentsComponent {
  private readonly meetingService = inject(MeetingService);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);

  // State
  public loading = signal<boolean>(true);
  public searchQuery = signal('');

  // Data
  public allAttachments: Signal<MeetingAttachmentWithContext[]> = this.initAttachments();

  // Filtered by search
  public filteredAttachments: Signal<MeetingAttachmentWithContext[]> = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const all = this.allAttachments();
    if (!query) return all;
    return all.filter((item) => item.attachment.name.toLowerCase().includes(query) || item.meetingTitle.toLowerCase().includes(query));
  });

  /** Opens attachment — link in new tab, file via download URL. */
  public openAttachment(item: MeetingAttachmentWithContext): void {
    if (item.attachment.type === 'link' && item.attachment.link) {
      window.open(item.attachment.link, '_blank', 'noopener,noreferrer');
    } else {
      this.meetingService.getMeetingAttachmentDownloadUrl(item.meetingId, item.attachment.uid).subscribe({
        next: (response) => {
          if (response?.download_url) {
            window.open(response.download_url, '_blank', 'noopener,noreferrer');
          }
        },
      });
    }
  }

  /** Formats file size for display. */
  public formatFileSize(bytes?: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Private initializer
  private initAttachments(): Signal<MeetingAttachmentWithContext[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.loading.set(true);
          return this.meetingService.getMeetingsByCommittee(c.uid, 100).pipe(
            switchMap((meetings) => {
              if (meetings.length === 0) return of([]);

              const attachmentRequests = meetings.map((meeting) =>
                this.meetingService.getMeetingAttachments(meeting.id).pipe(
                  catchError(() => of([])),
                  switchMap((attachments: MeetingAttachment[]) =>
                    of(
                      attachments.map((att) => ({
                        attachment: att,
                        meetingTitle: meeting.title,
                        meetingDate: meeting.start_time,
                        meetingId: meeting.id,
                      }))
                    )
                  )
                )
              );

              return forkJoin(attachmentRequests).pipe(
                switchMap((results) => of(results.flat().sort((a, b) => (b.attachment.created_at ?? '').localeCompare(a.attachment.created_at ?? ''))))
              );
            }),
            catchError(() => of([])),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
