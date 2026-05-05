// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { DocumentsTableComponent } from '@components/documents-table/documents-table.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { MEETING_GROUP_SOURCES } from '@lfx-one/shared/constants';
import { Committee, CommitteeDocument, MyDocumentItem, MyDocumentSource } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { combineLatest, debounceTime, distinctUntilChanged, filter, finalize, map, startWith, switchMap, take } from 'rxjs';

import { DocumentFormComponent } from '../document-form/document-form.component';

@Component({
  selector: 'lfx-committee-documents',
  imports: [ButtonComponent, CardComponent, InputTextComponent, SelectComponent, DocumentsTableComponent, ReactiveFormsModule],
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
  private readonly dialogService = inject(DialogService);

  // === Inputs ===
  public readonly committee = input.required<Committee>();
  public readonly canEdit = input<boolean>(false);

  // === Forms ===
  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(''),
    source: new FormControl<MyDocumentSource | null>(null),
  });

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly refreshTrigger = signal<number>(0);
  /** UID of the folder the user has drilled into; null means the root view. */
  protected readonly currentFolderUid = signal<string | null>(null);

  // === Static Options ===
  protected readonly sourceOptions: { label: string; value: MyDocumentSource | null }[] = [
    { label: 'All Sources', value: null },
    { label: 'Link', value: 'link' },
    { label: 'File', value: 'file' },
  ];

  // === Computed Signals ===
  protected readonly searchQuery: Signal<string> = this.initSearchQuery();
  protected readonly sourceFilter: Signal<MyDocumentSource | null> = this.initSourceFilter();
  protected readonly committeeDocuments: Signal<CommitteeDocument[]> = this.initCommitteeDocuments();
  protected readonly documents: Signal<MyDocumentItem[]> = this.initDocuments();
  protected readonly filteredDocuments: Signal<MyDocumentItem[]> = this.initFilteredDocuments();
  protected readonly folderOptions: Signal<{ label: string; value: string }[]> = this.initFolderOptions();
  /** The folder the user has drilled into, used by the breadcrumb. Null when at root. */
  protected readonly currentFolder: Signal<CommitteeDocument | null> = this.initCurrentFolder();

  // === Public Methods ===
  public openAddLinkDialog(): void {
    const dialogRef: DynamicDialogRef | null = this.dialogService.open(DocumentFormComponent, {
      header: 'Add Link',
      width: '560px',
      modal: true,
      closable: true,
      data: {
        mode: 'link',
        committeeId: this.committee().uid,
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
        committeeId: this.committee().uid,
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
      header: 'Upload File',
      width: '560px',
      modal: true,
      closable: true,
      data: {
        mode: 'file',
        committeeId: this.committee().uid,
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe({
      next: (result: boolean | undefined) => {
        if (result) {
          // Upload API doesn't accept folder_uid yet — pop to root so the new file is visible.
          this.currentFolderUid.set(null);
          this.refreshTrigger.update((v) => v + 1);
        }
      },
    });
  }

  // === Private Initializers ===
  private initSearchQuery(): Signal<string> {
    return toSignal(
      this.filterForm.controls.search.valueChanges.pipe(
        debounceTime(300),
        distinctUntilChanged(),
        map((v) => v ?? ''),
        startWith('')
      ),
      { initialValue: '' }
    );
  }

  private initSourceFilter(): Signal<MyDocumentSource | null> {
    return toSignal(this.filterForm.controls.source.valueChanges.pipe(startWith<MyDocumentSource | null>(null)), { initialValue: null });
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

      return ordered;
    });
  }

  private initFilteredDocuments(): Signal<MyDocumentItem[]> {
    return computed(() => {
      const docs = this.documents();
      const query = this.searchQuery().toLowerCase().trim();
      const source = this.sourceFilter();
      return docs.filter((doc) => {
        if (query && !doc.name.toLowerCase().includes(query) && !(doc.groupOrMeetingName ?? '').toLowerCase().includes(query)) {
          return false;
        }
        // Folder rows are structural navigation, not content — never filter them out by source.
        if (source && !doc.isFolder && doc.source !== source && !(source === 'meeting' && MEETING_GROUP_SOURCES.includes(doc.source))) {
          return false;
        }
        return true;
      });
    });
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
