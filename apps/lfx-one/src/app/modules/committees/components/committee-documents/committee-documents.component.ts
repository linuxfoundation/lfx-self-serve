// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { DocumentsTableComponent } from '@components/documents-table/documents-table.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { Committee, CommitteeDocument, FilterPillOption, MyDocumentItem, MyDocumentSource } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { DocumentService } from '@services/document.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, finalize, map, merge, of, startWith, Subject, switchMap, take } from 'rxjs';

import { DocumentFormComponent } from '@components/document-form/document-form.component';

@Component({
  selector: 'lfx-committee-documents',
  imports: [ButtonComponent, CardComponent, FilterPillsComponent, InputTextComponent, DocumentsTableComponent, ReactiveFormsModule],
  // NOTE: Do NOT provide MessageService here. It's already provided at root and a single
  // instance must back the global <p-toast /> in app.component.html. A local provider
  // creates a fresh instance whose messages never reach the root toast outlet.
  providers: [DialogService],
  templateUrl: './committee-documents.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeDocumentsComponent {
  // === Services ===
  private readonly committeeService = inject(CommitteeService);
  private readonly documentService = inject(DocumentService);
  private readonly dialogService = inject(DialogService);

  // === Inputs ===
  public readonly committee = input.required<Committee>();
  public readonly canEdit = input<boolean>(false);

  // === Forms ===
  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(''),
  });

  // === Subjects ===
  /** Emits immediately when the search box is programmatically cleared (e.g. on folder open),
   *  bypassing the 300 ms debounce so `searchQuery()` resets in the same tick. */
  private readonly clearSearch$ = new Subject<string>();

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly relatedLoading = signal<boolean>(true);
  protected readonly refreshTrigger = signal<number>(0);
  /** Selected source pill: 'all' or a source bucket (link, file, meeting, mailing_list). */
  protected readonly sourceTab = signal<string>('all');
  /** UID of the folder the user has drilled into; null means the root view. */
  protected readonly currentFolderUid = signal<string | null>(null);

  // === Static Options ===
  private readonly baseSourceTabOptions: FilterPillOption[] = [
    { id: 'all', label: 'All' },
    { id: 'link', label: 'Links' },
    { id: 'file', label: 'Files' },
    { id: 'meeting', label: 'Meetings' },
    { id: 'mailing_list', label: 'Mailing Lists' },
  ];

  // === Computed Signals ===
  protected readonly isLoading: Signal<boolean> = computed(() => this.loading() || this.relatedLoading());
  protected readonly searchQuery: Signal<string> = this.initSearchQuery();
  protected readonly committeeDocuments: Signal<CommitteeDocument[]> = this.initCommitteeDocuments();
  /** Meeting and mailing list documents associated with the committee (committee links are excluded; they come from committeeDocuments). */
  protected readonly relatedDocuments: Signal<MyDocumentItem[]> = this.initRelatedDocuments();
  protected readonly documents: Signal<MyDocumentItem[]> = this.initDocuments();
  protected readonly searchedDocuments: Signal<MyDocumentItem[]> = this.initSearchedDocuments();
  protected readonly sourceTabOptions: Signal<FilterPillOption[]> = this.initSourceTabOptions();
  protected readonly filteredDocuments: Signal<MyDocumentItem[]> = this.initFilteredDocuments();
  protected readonly folderOptions: Signal<{ label: string; value: string }[]> = this.initFolderOptions();
  /** The folder the user has drilled into, used by the breadcrumb. Null when at root. */
  protected readonly currentFolder: Signal<CommitteeDocument | null> = this.initCurrentFolder();

  // === Public Methods ===
  public onSourceTabChange(tab: string): void {
    this.sourceTab.set(tab);
  }

  public openAddLinkDialog(): void {
    const dialogRef: DynamicDialogRef | null = this.dialogService.open(DocumentFormComponent, {
      header: 'Add Link',
      width: '560px',
      modal: true,
      closable: true,
      data: {
        mode: 'link',
        entityType: 'committee',
        entityId: this.committee().uid,
        folders: this.folderOptions(),
        // Pre-select the folder the user is currently inside so the new link lands here
        defaultParentUid: this.currentFolderUid(),
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe({
      next: (result: boolean | undefined) => {
        if (result) {
          this.refreshTrigger.update((v) => v + 1);
        }
      },
    });
  }

  /** Drill into a folder shown in the table — switches the view to that folder's contents. */
  public onFolderOpen(doc: MyDocumentItem): void {
    const folderUid = doc.id.startsWith('committee_folder:') ? doc.id.slice('committee_folder:'.length) : null;
    if (folderUid) {
      // Update the form control visually without going through the debounce pipeline,
      // then immediately emit '' via clearSearch$ so searchQuery() resets in the same tick.
      this.filterForm.controls.search.setValue('', { emitEvent: false });
      this.clearSearch$.next('');
      this.currentFolderUid.set(folderUid);
    }
  }

  /** Reset the breadcrumb to the root view. */
  public onBreadcrumbHome(): void {
    this.currentFolderUid.set(null);
  }

  public openNewFolderDialog(): void {
    const dialogRef: DynamicDialogRef | null = this.dialogService.open(DocumentFormComponent, {
      header: 'New Folder',
      width: '560px',
      modal: true,
      closable: true,
      data: {
        mode: 'folder',
        entityType: 'committee',
        entityId: this.committee().uid,
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe({
      next: (result: boolean | undefined) => {
        if (result) {
          this.refreshTrigger.update((v) => v + 1);
        }
      },
    });
  }

  public openUploadFileDialog(): void {
    const dialogRef: DynamicDialogRef | null = this.dialogService.open(DocumentFormComponent, {
      header: 'Upload Files',
      width: '560px',
      modal: true,
      // File mode can partially succeed mid-batch; the header close icon bypasses the form's
      // own success-aware close result, so route dismissal only through Cancel/Done.
      // closeOnEscape defaults to true independently of closable — must be disabled too.
      closable: false,
      closeOnEscape: false,
      data: {
        mode: 'file',
        entityType: 'committee',
        entityId: this.committee().uid,
        folders: this.folderOptions(),
        defaultParentUid: this.currentFolderUid(),
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe({
      next: (result: boolean | undefined) => {
        if (result) {
          this.refreshTrigger.update((v) => v + 1);
        }
      },
    });
  }

  // === Private Initializers ===
  private initSearchQuery(): Signal<string> {
    return toSignal(
      merge(
        this.filterForm.controls.search.valueChanges.pipe(
          debounceTime(300),
          map((v) => v ?? '')
        ),
        this.clearSearch$
      ).pipe(distinctUntilChanged(), startWith('')),
      { initialValue: '' }
    );
  }

  /**
   * Derives the displayed `MyDocumentItem[]` from `committeeDocuments()` (the canonical
   * committee-scoped fetch backed by upstream `/folders`, `/links`, and indexed
   * `committee_document` resources). Previously this used `documentService.getMyDocuments()`
   * which queries the `committee_link` indexer type and explicitly filters out items without
   * a URL — that silently dropped folders and never included uploaded files.
   *
   * The list is scoped by `currentFolderUid()` for drill-down navigation:
   * - **Root view (currentFolderUid === null):** show folders (alphabetically) and any orphan
   *   items (no parent or parent deleted). Folders display a child count and are clickable.
   * - **Inside a folder (currentFolderUid set):** show only items whose `parent_uid` matches.
   */
  private initDocuments(): Signal<MyDocumentItem[]> {
    return computed(() => {
      const committee = this.committee();
      const docs = this.committeeDocuments();
      const committeeUid = committee?.uid;
      const groupName = committee?.name ?? '';
      const currentFolderUid = this.currentFolderUid();

      const folders = docs.filter((d) => d.type === 'folder');
      const nonFolders = docs.filter((d) => d.type !== 'folder');
      const folderUids = new Set(folders.map((f) => f.uid));

      // Folder view — show only direct children of the selected folder.
      if (currentFolderUid) {
        return nonFolders
          .filter((d) => d.parent_uid === currentFolderUid)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((d) => this.toDisplayItem(d, committeeUid, groupName, false));
      }

      // Root view — folders (with child counts) followed by orphan items.
      const childCountByFolder = new Map<string, number>();
      for (const item of nonFolders) {
        if (item.parent_uid && folderUids.has(item.parent_uid)) {
          childCountByFolder.set(item.parent_uid, (childCountByFolder.get(item.parent_uid) ?? 0) + 1);
        }
      }

      const ordered: MyDocumentItem[] = [];
      const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name));
      for (const folder of sortedFolders) {
        ordered.push({
          ...this.toDisplayItem(folder, committeeUid, groupName, false),
          isFolder: true,
          childCount: childCountByFolder.get(folder.uid) ?? 0,
        });
      }

      // Orphans appear at the bottom of the root view so newly uploaded files don't disappear.
      const orphans = nonFolders.filter((d) => !d.parent_uid || !folderUids.has(d.parent_uid)).sort((a, b) => a.name.localeCompare(b.name));
      for (const orphan of orphans) {
        ordered.push(this.toDisplayItem(orphan, committeeUid, groupName, false));
      }

      ordered.push(...this.relatedDocuments());

      return ordered;
    });
  }

  /** Documents after the search is applied but before the source pill, so pill counts show what each would list. */
  private initSearchedDocuments(): Signal<MyDocumentItem[]> {
    return computed(() => {
      const query = this.searchQuery().toLowerCase().trim();

      let docs: MyDocumentItem[];
      if (query && !this.currentFolderUid()) {
        const committee = this.committee();
        const committeeUid = committee?.uid;
        const groupName = committee?.name ?? '';
        const allDocs = this.committeeDocuments();
        const folderUids = new Set(allDocs.filter((d) => d.type === 'folder').map((f) => f.uid));
        const childCountByFolder = new Map<string, number>();
        for (const item of allDocs) {
          if (item.type !== 'folder' && item.parent_uid && folderUids.has(item.parent_uid)) {
            childCountByFolder.set(item.parent_uid, (childCountByFolder.get(item.parent_uid) ?? 0) + 1);
          }
        }
        docs = [
          ...allDocs.map((d) => ({
            ...this.toDisplayItem(d, committeeUid, groupName, false),
            isFolder: d.type === 'folder',
            ...(d.type === 'folder' ? { childCount: childCountByFolder.get(d.uid) ?? 0 } : {}),
          })),
          ...this.relatedDocuments(),
        ];
      } else {
        docs = this.documents();
      }
      return docs.filter((doc) => !query || doc.name.toLowerCase().includes(query) || (doc.groupOrMeetingName ?? '').toLowerCase().includes(query));
    });
  }

  private initSourceTabOptions(): Signal<FilterPillOption[]> {
    return computed(() => {
      // Don't show counts while either list is still loading; zero counts keep the plain label.
      if (this.isLoading()) return this.baseSourceTabOptions;
      // Folders are structural navigation, not content, so they are not counted.
      const rows = this.searchedDocuments().filter((doc) => !doc.isFolder);
      const counts = new Map<string, number>();
      for (const doc of rows) {
        const bucket = this.sourceBucket(doc);
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      }
      return this.baseSourceTabOptions.map((option) => {
        const count = option.id === 'all' ? rows.length : (counts.get(option.id) ?? 0);
        return count > 0 ? { ...option, label: `${option.label} (${count})` } : option;
      });
    });
  }

  private initFilteredDocuments(): Signal<MyDocumentItem[]> {
    return computed(() => {
      const tab = this.sourceTab();
      // Folder rows are structural navigation, not content — never filter them out by source.
      return this.searchedDocuments().filter((doc) => tab === 'all' || doc.isFolder || this.sourceBucket(doc) === tab);
    });
  }

  /**
   * Buckets a row by where it came from. The group's own documents keep their link/file kind;
   * everything else comes from the related fetch — mailing list artifacts, or meeting
   * attachments, recordings, transcripts and summaries (the "Meetings" bucket).
   */
  private sourceBucket(doc: MyDocumentItem): string {
    if (doc.id.startsWith('committee_')) return doc.source;
    return doc.source === 'mailing_list' ? 'mailing_list' : 'meeting';
  }

  private initCommitteeDocuments(): Signal<CommitteeDocument[]> {
    return toSignal(
      combineLatest([toObservable(this.committee), toObservable(this.refreshTrigger)]).pipe(
        filter(([committee]) => !!committee?.uid),
        switchMap(([committee]) => {
          this.loading.set(true);
          return this.committeeService.getCommitteeDocuments(committee.uid).pipe(finalize(() => this.loading.set(false)));
        })
      ),
      { initialValue: [] as CommitteeDocument[] }
    );
  }

  private initRelatedDocuments(): Signal<MyDocumentItem[]> {
    return toSignal(
      // Keyed on the committee uid only: adding a link, folder or file can't change meeting or mailing list items.
      toObservable(this.committee).pipe(
        map((committee) => committee?.uid),
        filter((uid): uid is string => !!uid),
        distinctUntilChanged(),
        switchMap((uid) => {
          this.relatedLoading.set(true);
          return this.documentService.getMyDocuments(null, uid).pipe(
            map((items) => items.filter((item) => !item.id.startsWith('committee_link:'))),
            catchError((err: { status?: number }) => {
              console.warn('Failed to load related committee documents', err?.status);
              return of([] as MyDocumentItem[]);
            }),
            finalize(() => this.relatedLoading.set(false))
          );
        })
      ),
      { initialValue: [] as MyDocumentItem[] }
    );
  }

  /**
   * Maps an upstream-shaped CommitteeDocument to the unified MyDocumentItem the table renders.
   * Folders use source `'link'` as a placeholder (the row is rendered via `isFolder` and
   * skipped by the Source filter — see `initFilteredDocuments`). Files get a `downloadUrl`
   * pointing at the BFF streaming endpoint.
   */
  private toDisplayItem(doc: CommitteeDocument, committeeUid: string | undefined, groupName: string, isChild: boolean): MyDocumentItem {
    const isFile = doc.type === 'file';
    const ownerCommitteeUid = committeeUid ?? doc.committee_uid ?? '';
    return {
      id: `committee_${doc.type}:${doc.uid}`,
      name: doc.name,
      source: (isFile ? 'file' : 'link') as MyDocumentSource,
      foundationName: '',
      // Intentionally undefined for committee documents — committee.project_uid may be a
      // sub-project, not a foundation, so populating this would mislabel any downstream
      // consumer that uses it for foundation-scoped routing. The column is hidden here.
      foundationUid: undefined,
      groupOrMeetingName: groupName,
      groupOrMeetingUid: ownerCommitteeUid,
      date: doc.created_at ?? doc.updated_at ?? '',
      url: doc.url,
      attachmentUid: isFile ? doc.uid : undefined,
      fileType: doc.mime_type,
      parentUid: doc.parent_uid,
      isChild,
      downloadUrl: isFile && ownerCommitteeUid ? `/api/committees/${ownerCommitteeUid}/documents/${doc.uid}/download` : undefined,
      uploadedBy: doc.uploaded_by,
    };
  }

  private initFolderOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() =>
      this.committeeDocuments()
        .filter((doc) => doc.type === 'folder')
        .map((folder) => ({ label: folder.name, value: folder.uid }))
    );
  }

  private initCurrentFolder(): Signal<CommitteeDocument | null> {
    return computed(() => {
      const uid = this.currentFolderUid();
      if (!uid) return null;
      return this.committeeDocuments().find((doc) => doc.type === 'folder' && doc.uid === uid) ?? null;
    });
  }
}
