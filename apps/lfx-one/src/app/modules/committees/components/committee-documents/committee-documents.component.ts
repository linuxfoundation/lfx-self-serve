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
import { DocumentIconPipe } from '../../pipes/document-icon.pipe';
import { DocumentTypeIconPipe } from '../../pipes/document-type-icon.pipe';
import { SourceLabelPipe } from '../../pipes/source-label.pipe';
import { SourceSeverityPipe } from '../../pipes/source-severity.pipe';
import { Committee, CommitteeDocument, DocumentDisplayItem, MeetingAttachment, MeetingAttachmentWithContext } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import {
  catchError,
  combineLatest,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  filter,
  finalize,
  from,
  map,
  mergeMap,
  of,
  switchMap,
  take,
  toArray,
} from 'rxjs';

import { DocumentFormComponent } from '../document-form/document-form.component';

/** Max concurrent attachment fetches to avoid overwhelming the backend. */
const ATTACHMENT_FETCH_CONCURRENCY = 4;

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
    DocumentIconPipe,
    DocumentTypeIconPipe,
    FileSizePipe,
    SourceLabelPipe,
    SourceSeverityPipe,
    DatePipe,
    DynamicDialogModule,
    ConfirmDialogModule,
  ],
  providers: [DialogService, ConfirmationService],
  templateUrl: './committee-documents.component.html',
  styleUrl: './committee-documents.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeDocumentsComponent implements OnInit {
  private readonly meetingService = inject(MeetingService);
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);

  // State
  public meetingLoading = signal<boolean>(true);
  public standaloneLoading = signal<boolean>(true);
  /** True while a cascading folder delete (children + folder) is in flight — disables all mutating actions. */
  public cascadeDeleting = signal(false);
  public loading = computed(() => this.meetingLoading() || this.standaloneLoading());
  public searchQuery = signal('');
  public sourceFilter = signal<string | null>(null);
  public standaloneDocsVersion = signal(0);
  public expandedFolders = signal<Set<string>>(new Set());

  // Form
  public searchForm = new FormGroup({
    search: new FormControl(''),
    source: new FormControl<string | null>(null),
  });

  public sourceOptions = [
    { label: 'Link', value: 'link' },
    { label: 'Meeting', value: 'meeting' },
    { label: 'Folder', value: 'folder' },
  ];

  // Folder options for the Add Link dialog
  public folderOptions = computed(() =>
    this.standaloneDocs()
      .filter((doc) => doc.type === 'folder')
      .map((folder) => ({ label: folder.name, value: folder.uid }))
  );

  // Data — meeting attachments
  public meetingAttachments: Signal<MeetingAttachmentWithContext[]> = this.initMeetingAttachments();

  // Data — standalone committee documents
  public standaloneDocs: Signal<CommitteeDocument[]> = this.initStandaloneDocuments();

  // Maps folder UID → child document items for hierarchy display
  public folderChildMap: Signal<Map<string, DocumentDisplayItem[]>> = this.initFolderChildMap();

  // Merged display items (flat, unsorted — does NOT include folder children)
  public allDocuments: Signal<DocumentDisplayItem[]> = this.initAllDocuments();

  // Filtered by search and source, with folder hierarchy (children inserted after expanded folders)
  public filteredDocuments: Signal<DocumentDisplayItem[]> = this.initFilteredDocuments();

  public ngOnInit(): void {
    this.searchForm.controls.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.searchQuery.set(value ?? ''));

    this.searchForm.controls.source.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.sourceFilter.set(value));
  }

  /** Opens document — links in new tab, meeting files via download URL. */
  public openDocument(item: DocumentDisplayItem): void {
    if (item.type === 'folder') {
      return; // Folders are not clickable
    }

    if (item.isStandalone && item.url) {
      this.openSafeUrl(item.url);
    } else if (item.meetingAttachment) {
      if (item.meetingAttachment.attachment.type === 'link' && item.meetingAttachment.attachment.link) {
        this.openSafeUrl(item.meetingAttachment.attachment.link);
      } else {
        this.meetingService.getMeetingAttachmentDownloadUrl(item.meetingAttachment.meetingId, item.meetingAttachment.attachment.uid).subscribe({
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
  }

  /** Toggles a folder's expanded/collapsed state. */
  public toggleFolder(folderUid: string): void {
    this.expandedFolders.update((set) => {
      const next = new Set(set);
      if (next.has(folderUid)) {
        next.delete(folderUid);
      } else {
        next.add(folderUid);
      }
      return next;
    });
  }

  /** Whether a folder is currently expanded. */
  public isFolderExpanded(folderUid: string): boolean {
    return this.expandedFolders().has(folderUid);
  }

  // ── CRUD Dialog Methods ──────────────────────────────────────────────────

  public openAddLinkDialog(): void {
    // Wait for standalone docs to settle so folder list is current
    if (this.standaloneLoading()) return;

    const dialogRef = this.dialogService.open(DocumentFormComponent, {
      header: 'Add Link',
      width: '560px',
      modal: true,
      closable: true,
      data: {
        mode: 'link',
        committeeId: this.committee().uid,
        folders: this.folderOptions(),
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe((result: boolean | undefined) => {
      if (result) {
        this.refreshStandaloneDocs();
      }
    });
  }

  public openNewFolderDialog(): void {
    const dialogRef = this.dialogService.open(DocumentFormComponent, {
      header: 'New Folder',
      width: '560px',
      modal: true,
      closable: true,
      data: {
        mode: 'folder',
        committeeId: this.committee().uid,
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe((result: boolean | undefined) => {
      if (result) {
        this.refreshStandaloneDocs();
      }
    });
  }

  public confirmDeleteDocument(item: DocumentDisplayItem): void {
    if (!item.committeeDocument) return;

    if (item.type === 'folder') {
      const childCount = this.folderChildMap().get(item.uid)?.length ?? 0;
      const childDetail = childCount > 0 ? ` This folder contains ${childCount} link${childCount !== 1 ? 's' : ''} that will also be permanently deleted.` : '';

      this.confirmationService.confirm({
        message: `Are you sure you want to delete the folder "${item.name}"?${childDetail} This action cannot be undone.`,
        header: 'Delete Folder',
        icon: 'fa-light fa-triangle-exclamation',
        acceptButtonStyleClass: 'p-button-danger p-button-sm',
        rejectButtonStyleClass: 'p-button-secondary p-button-outlined p-button-sm',
        acceptLabel: childCount > 0 ? 'Delete Folder & Links' : 'Delete Folder',
        rejectLabel: 'Cancel',
        accept: () => this.performDelete(item),
      });
    } else {
      this.confirmationService.confirm({
        message: `Are you sure you want to permanently delete the link "${item.name}"? This action cannot be undone.`,
        header: 'Delete Link',
        icon: 'fa-light fa-triangle-exclamation',
        acceptButtonStyleClass: 'p-button-danger p-button-sm',
        rejectButtonStyleClass: 'p-button-secondary p-button-outlined p-button-sm',
        acceptLabel: 'Delete',
        rejectLabel: 'Cancel',
        accept: () => this.performDelete(item),
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

  private performDelete(item: DocumentDisplayItem): void {
    if (!item.committeeDocument) return;

    const committeeId = this.committee().uid;
    const typeLabel = item.type === 'folder' ? 'Folder' : 'Link';

    if (item.type === 'folder') {
      const children = this.folderChildMap().get(item.uid) ?? [];
      const deletableChildren = children.filter((child) => child.committeeDocument);

      if (deletableChildren.length === 0) {
        // Empty folder — delete directly, no cascade needed.
        this.committeeService.deleteCommitteeDocument(committeeId, item.committeeDocument.uid, 'folder').subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Deleted', detail: `"${item.name}" has been deleted` });
            this.refreshStandaloneDocs();
          },
          error: (err) => this.showDeleteError(err, typeLabel),
        });
        return;
      }

      // Upstream requires folders to be empty before deletion.
      // Delete children sequentially (concatMap) so a failure aborts the cascade immediately
      // rather than leaving a partially-emptied folder. cascadeDeleting disables all
      // mutating actions in the UI until the operation settles.
      this.cascadeDeleting.set(true);

      from(deletableChildren)
        .pipe(
          concatMap((child) =>
            this.committeeService.deleteCommitteeDocument(committeeId, child.committeeDocument!.uid, child.committeeDocument!.type)
          ),
          toArray(),
          switchMap(() => this.committeeService.deleteCommitteeDocument(committeeId, item.committeeDocument!.uid, 'folder')),
          finalize(() => this.cascadeDeleting.set(false))
        )
        .subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Deleted', detail: `"${item.name}" and its contents have been deleted` });
            this.refreshStandaloneDocs();
          },
          error: (err) => {
            this.refreshStandaloneDocs(); // Reflect any partial state
            this.showDeleteError(err, typeLabel);
          },
        });
    } else {
      this.committeeService.deleteCommitteeDocument(committeeId, item.committeeDocument.uid, item.committeeDocument.type).subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Deleted', detail: `"${item.name}" has been deleted` });
          this.refreshStandaloneDocs();
        },
        error: (err) => this.showDeleteError(err, typeLabel),
      });
    }
  }

  private showDeleteError(err: { status?: number; error?: { message?: string } }, typeLabel: string): void {
    let errorMessage = `Failed to delete ${typeLabel.toLowerCase()}. Please try again.`;
    if (err?.status === 404) {
      errorMessage = `${typeLabel} not found. It may have already been deleted.`;
    } else if (err?.status === 403) {
      errorMessage = `You do not have permission to delete this ${typeLabel.toLowerCase()}.`;
    } else if (err?.error?.message) {
      errorMessage = err.error.message;
    }
    this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: errorMessage });
  }

  private refreshStandaloneDocs(): void {
    this.standaloneDocsVersion.update((v) => v + 1);
  }

  // ── Private Initializers ─────────────────────────────────────────────────

  private initFolderChildMap(): Signal<Map<string, DocumentDisplayItem[]>> {
    return computed(() => {
      const childMap = new Map<string, DocumentDisplayItem[]>();
      for (const doc of this.standaloneDocs()) {
        if (doc.parent_uid) {
          const children = childMap.get(doc.parent_uid) || [];
          children.push({
            uid: doc.uid,
            name: doc.name,
            type: doc.type,
            url: doc.url,
            description: doc.description,
            addedBy: doc.uploaded_by || doc.created_by,
            date: doc.created_at || doc.updated_at,
            fileSize: doc.file_size,
            source: doc.type,
            isStandalone: true,
            committeeDocument: doc,
            parentUid: doc.parent_uid,
            isChild: true,
          });
          childMap.set(doc.parent_uid, children);
        }
      }
      return childMap;
    });
  }

  private initAllDocuments(): Signal<DocumentDisplayItem[]> {
    return computed(() => {
      const childMap = this.folderChildMap();

      const meetingItems: DocumentDisplayItem[] = this.meetingAttachments().map((item) => ({
        uid: item.attachment.uid,
        name: item.attachment.name,
        type: item.attachment.type,
        url: item.attachment.link,
        description: item.attachment.description ?? '',
        addedBy: item.attachment.created_by?.name,
        date: item.attachment.created_at,
        fileSize: item.attachment.file_size,
        source: 'meeting' as const,
        isStandalone: false,
        meetingAttachment: item,
      }));

      const standaloneItems: DocumentDisplayItem[] = this.standaloneDocs()
        .filter((doc) => !doc.parent_uid)
        .map((doc) => ({
          uid: doc.uid,
          name: doc.name,
          type: doc.type,
          url: doc.url,
          description: doc.description,
          addedBy: doc.uploaded_by || doc.created_by,
          date: doc.created_at || doc.updated_at,
          fileSize: doc.file_size,
          source: doc.type,
          isStandalone: true,
          committeeDocument: doc,
          childCount: doc.type === 'folder' ? (childMap.get(doc.uid)?.length ?? 0) : undefined,
        }));

      return [...meetingItems, ...standaloneItems].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
    });
  }

  private initFilteredDocuments(): Signal<DocumentDisplayItem[]> {
    return computed(() => {
      const query = this.searchQuery().toLowerCase().trim();
      const source = this.sourceFilter();
      const expanded = this.expandedFolders();
      const childMap = this.folderChildMap();

      let results = this.allDocuments();

      // When searching, flatten everything (show matching children as standalone rows with isChild reset)
      if (query) {
        const allChildren = [...childMap.values()].flat().map((child) => ({ ...child, isChild: false }));
        const allItems = [...results, ...allChildren];
        results = allItems.filter(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            (item.meetingAttachment?.meetingTitle ?? '').toLowerCase().includes(query) ||
            (item.description ?? '').toLowerCase().includes(query)
        );
        if (source) {
          results = results.filter((item) => item.source === source);
        }
        return results;
      }

      if (source) {
        results = results.filter((item) => item.source === source || item.type === 'folder');
        // Hide folders that have no children matching the filter and aren't the filter themselves
        if (source !== 'folder') {
          results = results.filter((item) => item.type !== 'folder' || (childMap.get(item.uid)?.some((child) => child.source === source) ?? false));
        }
      }

      // Insert folder children after expanded folders
      const display: DocumentDisplayItem[] = [];
      for (const item of results) {
        display.push(item);
        if (item.type === 'folder' && expanded.has(item.uid)) {
          let children = childMap.get(item.uid) ?? [];
          if (source) {
            children = children.filter((child) => child.source === source);
          }
          display.push(...children);
        }
      }

      return display;
    });
  }

  private initMeetingAttachments(): Signal<MeetingAttachmentWithContext[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.meetingLoading.set(true);
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
                map((results) =>
                  results.flat().sort((a, b) => new Date(b.attachment.created_at ?? 0).getTime() - new Date(a.attachment.created_at ?? 0).getTime())
                )
              );
            }),
            catchError(() => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load meeting documents. Please try again.' });
              return of([]);
            }),
            finalize(() => this.meetingLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initStandaloneDocuments(): Signal<CommitteeDocument[]> {
    // Both toObservable calls must be at the top level (injection context).
    // combineLatest re-emits when either the committee changes or the version bumps (refresh).
    return toSignal(
      combineLatest([toObservable(this.committee), toObservable(this.standaloneDocsVersion)]).pipe(
        filter(([c]) => !!c?.uid),
        switchMap(([c]) => {
          this.standaloneLoading.set(true);
          return this.committeeService.getCommitteeDocuments(c.uid).pipe(
            catchError(() => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load committee documents. Please try again.' });
              return of([] as CommitteeDocument[]);
            }),
            finalize(() => this.standaloneLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
