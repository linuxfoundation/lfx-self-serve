// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardComponent } from '@components/card/card.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FileSizePipe } from '@pipes/file-size.pipe';
import { DocumentSourceActionPipe } from '@pipes/document-source-action.pipe';
import { DocumentSourceIconPipe } from '@pipes/document-source-icon.pipe';
import { DocumentSourceTagPipe } from '@pipes/document-source-tag.pipe';
import {
  Committee,
  CommitteeDocumentItem,
  Meeting,
  MeetingAttachment,
  PastMeeting,
  PastMeetingAttachment,
  PastMeetingRecording,
  PastMeetingSummary,
} from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { RecordingModalComponent } from '@components/recording-modal/recording-modal.component';
import { SummaryModalComponent } from '@components/summary-modal/summary-modal.component';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { Observable, catchError, debounceTime, distinctUntilChanged, filter, finalize, forkJoin, from, map, mergeMap, of, switchMap, toArray } from 'rxjs';
import {
  mapAttachmentToDoc,
  mapRecordingFileToDoc,
  mapSummaryToDoc,
  getLargestSessionShareUrl,
  isAllowedRecordingFileType,
} from '../../utils/committee-document.utils';

/** Max concurrent per-meeting fetches to avoid overwhelming the backend. */
const FETCH_CONCURRENCY = 4;

/**
 * Max meetings to fetch per type (upcoming/past).
 * Kept low to limit N+1 API fan-out (each past meeting triggers 3 calls).
 * TODO: Replace with a backend aggregate endpoint that returns documents for all meetings in one call.
 */
const MAX_MEETINGS_PER_TYPE = 25;

@Component({
  selector: 'lfx-committee-documents',
  imports: [
    CardComponent,
    ButtonComponent,
    InputTextComponent,
    SelectComponent,
    ReactiveFormsModule,
    TableComponent,
    TagComponent,
    FileSizePipe,
    DatePipe,
    DynamicDialogModule,
    DocumentSourceActionPipe,
    DocumentSourceIconPipe,
    DocumentSourceTagPipe,
  ],
  providers: [DialogService],
  templateUrl: './committee-documents.component.html',
  styleUrl: './committee-documents.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeDocumentsComponent implements OnInit {
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  public committee = input.required<Committee>();

  // State
  public loading = signal<boolean>(true);
  public searchQuery = signal('');
  public sourceFilter = signal<string | null>(null);

  // Form
  public searchForm = new FormGroup({
    search: new FormControl(''),
    source: new FormControl<string | null>(null),
  });

  public sourceOptions = [
    { label: 'Link', value: 'link' },
    { label: 'File', value: 'file' },
    { label: 'Recording', value: 'recording' },
    { label: 'Transcript', value: 'transcript' },
    { label: 'AI Summary', value: 'summary' },
  ];

  // Data
  public allDocuments: Signal<CommitteeDocumentItem[]> = this.initDocuments();
  public filteredDocuments: Signal<CommitteeDocumentItem[]> = this.initFilteredDocuments();

  public ngOnInit(): void {
    this.searchForm.controls.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.searchQuery.set(value ?? ''));

    this.searchForm.controls.source.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.sourceFilter.set(value));
  }

  /** Opens or downloads a document based on its source type. */
  public openDocument(item: CommitteeDocumentItem): void {
    switch (item.source) {
      case 'link':
        return this.openLink(item);
      case 'file':
        return this.downloadFile(item);
      case 'recording':
        return this.openRecording(item);
      case 'transcript':
        return this.downloadTranscript(item);
      case 'summary':
        return this.openSummary(item);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-source document handlers
  // ---------------------------------------------------------------------------

  private openLink(item: CommitteeDocumentItem): void {
    if (item.linkUrl) {
      this.openSafeUrl(item.linkUrl);
    }
  }

  private downloadFile(item: CommitteeDocumentItem): void {
    if (!item.attachmentUid) return;
    const download$ = item.pastMeetingId
      ? this.meetingService.getPastMeetingAttachmentDownloadUrl(item.pastMeetingId, item.attachmentUid)
      : this.meetingService.getMeetingAttachmentDownloadUrl(item.meetingId, item.attachmentUid);
    download$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  private openRecording(item: CommitteeDocumentItem): void {
    if (item.shareUrl) {
      this.dialogService.open(RecordingModalComponent, {
        header: 'Meeting Recording',
        width: '650px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: { shareUrl: item.shareUrl, meetingTitle: item.meetingTitle },
      });
    } else if (item.playUrl) {
      this.openSafeUrl(item.playUrl);
    }
  }

  private downloadTranscript(item: CommitteeDocumentItem): void {
    if (item.downloadUrl) {
      this.openSafeUrl(item.downloadUrl);
    }
  }

  private openSummary(item: CommitteeDocumentItem): void {
    if (item.summaryData && item.pastMeetingId) {
      this.dialogService.open(SummaryModalComponent, {
        header: 'Meeting Summary',
        width: '800px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          summaryContent: item.summaryData.content,
          summaryUid: item.summaryData.uid,
          pastMeetingUid: item.pastMeetingId,
          meetingTitle: item.meetingTitle,
          approved: item.summaryData.approved,
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

  // ---------------------------------------------------------------------------
  // Private initializers
  // ---------------------------------------------------------------------------

  private initFilteredDocuments(): Signal<CommitteeDocumentItem[]> {
    return computed(() => {
      const query = this.searchQuery().toLowerCase().trim();
      const source = this.sourceFilter();
      let results = this.allDocuments();
      if (query) {
        results = results.filter((item) => item.name.toLowerCase().includes(query) || item.meetingTitle.toLowerCase().includes(query));
      }
      if (source) {
        results = results.filter((item) => item.source === source);
      }
      return results;
    });
  }

  private initDocuments(): Signal<CommitteeDocumentItem[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.loading.set(true);

          return forkJoin({
            upcoming: this.meetingService.getMeetingsByCommittee(c.uid, MAX_MEETINGS_PER_TYPE).pipe(catchError(() => of([] as Meeting[]))),
            past: this.meetingService.getPastMeetingsByCommittee(c.uid, MAX_MEETINGS_PER_TYPE).pipe(catchError(() => of([] as PastMeeting[]))),
          }).pipe(
            switchMap(({ upcoming, past }) => {
              const upcomingDocs$ = upcoming.length
                ? from(upcoming).pipe(
                    mergeMap((meeting) => this.fetchUpcomingMeetingDocs(meeting), FETCH_CONCURRENCY),
                    toArray(),
                    map((arrays) => arrays.flat())
                  )
                : of([] as CommitteeDocumentItem[]);

              const pastDocs$ = past.length
                ? from(past).pipe(
                    mergeMap((meeting) => this.fetchPastMeetingDocs(meeting), FETCH_CONCURRENCY),
                    toArray(),
                    map((arrays) => arrays.flat())
                  )
                : of([] as CommitteeDocumentItem[]);

              return forkJoin([upcomingDocs$, pastDocs$]).pipe(
                map(([u, p]) => [...u, ...p].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()))
              );
            }),
            catchError(() => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load documents. Please try again.' });
              return of([] as CommitteeDocumentItem[]);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  // ---------------------------------------------------------------------------
  // Per-meeting fetchers
  // ---------------------------------------------------------------------------

  private fetchUpcomingMeetingDocs(meeting: Meeting): Observable<CommitteeDocumentItem[]> {
    return this.meetingService.getMeetingAttachments(meeting.id).pipe(
      catchError(() => of([] as MeetingAttachment[])),
      map((attachments) => attachments.map((att) => mapAttachmentToDoc(att, meeting.title, meeting.start_time, meeting.id, null)))
    );
  }

  private fetchPastMeetingDocs(meeting: PastMeeting): Observable<CommitteeDocumentItem[]> {
    const title = meeting.title;
    const date = meeting.scheduled_start_time || meeting.start_time;
    const meetingId = meeting.meeting_id || meeting.id;
    const pastMeetingId = meeting.id;

    return forkJoin({
      attachments: this.meetingService.getPastMeetingAttachments(pastMeetingId).pipe(catchError(() => of(null as PastMeetingAttachment[] | null))),
      recording: this.meetingService.getPastMeetingRecording(pastMeetingId).pipe(catchError(() => of(null as PastMeetingRecording | null))),
      summary: this.meetingService.getPastMeetingSummary(pastMeetingId).pipe(catchError(() => of(null as PastMeetingSummary | null))),
    }).pipe(
      map(({ attachments, recording, summary }) => {
        const docs: CommitteeDocumentItem[] = [];

        if (attachments) {
          for (const att of attachments) {
            docs.push(mapAttachmentToDoc(att, title, date, meetingId, pastMeetingId));
          }
        }

        if (recording?.recording_files) {
          const shareUrl = getLargestSessionShareUrl(recording);
          for (const file of recording.recording_files) {
            if (!isAllowedRecordingFileType(file.file_type)) continue;
            docs.push(mapRecordingFileToDoc(file, shareUrl, title, date, meetingId, pastMeetingId));
          }
        }

        if (summary?.summary_data) {
          const content = summary.summary_data.edited_content || summary.summary_data.content;
          if (content) {
            docs.push(mapSummaryToDoc(summary, title, date, meetingId, pastMeetingId));
          }
        }

        return docs;
      })
    );
  }
}
