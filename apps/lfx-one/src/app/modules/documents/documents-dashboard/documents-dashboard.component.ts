// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { DocumentsTableComponent } from '@components/documents-table/documents-table.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { DOCUMENT_LABEL, MEETING_GROUP_SOURCES } from '@lfx-one/shared/constants';
import { DocumentFormMode, FilterPillOption, MyDocumentItem, MyDocumentSource, ProjectContext, ProjectDocument } from '@lfx-one/shared/interfaces';
import { DocumentService } from '@services/document.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { combineLatest, catchError, debounceTime, distinctUntilChanged, finalize, map, of, startWith, switchMap, take } from 'rxjs';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MyDocumentSourceTagPipe } from '@app/shared/pipes/my-document-source-tag.pipe';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';

import { DocumentFormComponent } from '@components/document-form/document-form.component';

@Component({
  selector: 'lfx-documents-dashboard',
  imports: [
    CardComponent,
    CardTabsBarComponent,
    ButtonComponent,
    DocumentsTableComponent,
    InputTextComponent,
    SelectComponent,
    TableComponent,
    TagComponent,
    ReactiveFormsModule,
    DatePipe,
    MyDocumentSourceTagPipe,
    EmptyStateComponent,
    SkeletonModule,
    TooltipModule,
  ],
  // NOTE: Do NOT provide MessageService here. It's already provided at root and a single
  // instance must back the global <p-toast /> in app.component.html. A local provider
  // creates a fresh instance whose messages never reach the root toast outlet.
  providers: [DialogService],
  templateUrl: './documents-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsDashboardComponent {
  // === Services ===
  private readonly documentService = inject(DocumentService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly lensService = inject(LensService);
  private readonly personaService = inject(PersonaService);
  private readonly dialogService = inject(DialogService);
  private readonly projectService = inject(ProjectService);

  // === Constants ===
  protected readonly documentLabel = DOCUMENT_LABEL;
  protected readonly sourceTabOptions: FilterPillOption[] = [
    { id: 'all', label: 'All Sources' },
    { id: 'link', label: 'Links' },
    { id: 'meeting', label: 'Meetings' },
    { id: 'mailing_list', label: 'Mailing Lists' },
  ];

  // === Forms ===
  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(''),
    /** Project-mode source filter: 'link' | 'file' | null. Folders are never filtered out (they're navigation). */
    projectSource: new FormControl<MyDocumentSource | null>(null),
    foundation: new FormControl<string | null>(null),
    group: new FormControl<string | null>(null),
    meeting: new FormControl<string | null>(null),
    mailingList: new FormControl<string | null>(null),
  });

  /** Source filter options shown on the Project / Foundation lens (mirrors committee-documents). */
  protected readonly projectSourceOptions: { label: string; value: MyDocumentSource | null }[] = [
    { label: 'All Sources', value: null },
    { label: 'Link', value: 'link' },
    { label: 'File', value: 'file' },
  ];

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly sourceTab = signal<string>('all');
  /** Bumped after a successful upload/folder/link create so the document list re-fetches. */
  protected readonly refreshTrigger = signal<number>(0);
  /** UID of the folder the user has drilled into; null means the root view (project mode only). */
  protected readonly currentFolderUid = signal<string | null>(null);

  // === Computed Signals ===
  protected readonly project = this.projectContextService.activeContext;
  protected readonly activeLens = this.lensService.activeLens;
  protected readonly personaLoaded = this.personaService.personaLoaded;
  // Toolbar gated only on project-scope so it can't render under the legacy aggregator (no-op clicks).
  protected readonly canUpload = computed(() => this.useProjectSource());
  /** True when the dashboard is project-scoped (Project / Foundation lens with active context). */
  protected readonly useProjectSource = computed(() => {
    const lens = this.activeLens();
    return !!this.project()?.uid && (lens === 'project' || lens === 'foundation');
  });
  protected readonly pageTitle = computed(() => (this.lensService.activeLens() === 'me' ? 'My Documents' : 'Documents'));
  protected readonly searchQuery: Signal<string> = this.initSearchQuery();
  protected readonly projectSourceFilter: Signal<MyDocumentSource | null> = this.initProjectSourceFilter();
  protected readonly foundationFilter: Signal<string | null> = this.initFoundationFilter();
  protected readonly groupFilter: Signal<string | null> = this.initGroupFilter();
  protected readonly meetingFilter: Signal<string | null> = this.initMeetingFilter();
  protected readonly mailingListFilter: Signal<string | null> = this.initMailingListFilter();
  /** Raw project documents (pre-derivation) — used for folder/orphan structure + folder picker options. */
  protected readonly rawProjectDocuments: Signal<ProjectDocument[]> = this.initRawProjectDocuments();
  /** Aggregator-fed documents (Me / Org lens, or no project context). */
  protected readonly legacyDocuments: Signal<MyDocumentItem[]> = this.initLegacyDocuments();
  protected readonly documents: Signal<MyDocumentItem[]> = this.initDocuments();
  protected readonly filteredDocuments: Signal<MyDocumentItem[]> = this.initFilteredDocuments();
  protected readonly rppOptions = computed<number[] | undefined>(() => (this.filteredDocuments().length > 10 ? [10, 25, 50] : undefined));
  protected readonly foundationOptions: Signal<{ label: string; value: string | null }[]> = this.initFoundationOptions();
  protected readonly groupOptions: Signal<{ label: string; value: string | null }[]> = this.initGroupOptions();
  protected readonly meetingOptions: Signal<{ label: string; value: string | null }[]> = this.initMeetingOptions();
  protected readonly mailingListOptions: Signal<{ label: string; value: string | null }[]> = this.initMailingListOptions();
  /** Folder options for the upload/link dialog (project mode only). */
  protected readonly folderOptions: Signal<{ label: string; value: string }[]> = this.initFolderOptions();
  /** The folder the user has drilled into (project mode), used by the breadcrumb. Null at root. */
  protected readonly currentFolder: Signal<ProjectDocument | null> = this.initCurrentFolder();
  // Branch on documents() (post-drilldown) so an empty folder doesn't read "No results found" with no filter active.
  protected readonly projectEmptyMessage = computed(() => {
    if (this.documents().length === 0) {
      return this.currentFolder() ? 'This folder is empty' : 'No documents yet';
    }
    return 'No results found';
  });

  // === Protected Methods ===
  protected onSourceTabChange(tab: string): void {
    this.sourceTab.set(tab);
  }

  protected resetFilters(): void {
    this.filterForm.reset({ search: '', foundation: null, group: null, meeting: null, mailingList: null });
    this.sourceTab.set('all');
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

  /** Drill into a folder shown in the table — switches the view to that folder's contents. */
  protected onFolderOpen(doc: MyDocumentItem): void {
    const folderUid = doc.id.startsWith('project_folder:') ? doc.id.slice('project_folder:'.length) : null;
    if (folderUid) {
      this.currentFolderUid.set(folderUid);
    }
  }

  /** Reset the breadcrumb to the root view. */
  protected onBreadcrumbHome(): void {
    this.currentFolderUid.set(null);
  }

  protected openUploadFileDialog(): void {
    this.openDocumentDialog('file', 'Upload File');
  }

  protected openNewFolderDialog(): void {
    this.openDocumentDialog('folder', 'New Folder');
  }

  protected openAddLinkDialog(): void {
    this.openDocumentDialog('link', 'Add Link');
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

  private initProjectSourceFilter(): Signal<MyDocumentSource | null> {
    return toSignal(this.filterForm.controls.projectSource.valueChanges.pipe(startWith<MyDocumentSource | null>(null)), { initialValue: null });
  }

  private initFoundationFilter(): Signal<string | null> {
    return toSignal(this.filterForm.controls.foundation.valueChanges.pipe(startWith<string | null>(null)), { initialValue: null });
  }

  private initGroupFilter(): Signal<string | null> {
    return toSignal(this.filterForm.controls.group.valueChanges.pipe(startWith<string | null>(null)), { initialValue: null });
  }

  private initMeetingFilter(): Signal<string | null> {
    return toSignal(this.filterForm.controls.meeting.valueChanges.pipe(startWith<string | null>(null)), { initialValue: null });
  }

  private initMailingListFilter(): Signal<string | null> {
    return toSignal(this.filterForm.controls.mailingList.valueChanges.pipe(startWith<string | null>(null)), { initialValue: null });
  }

  /**
   * Fetches raw project documents (folders + links + files) from the project-service backend.
   * Only fires when in project mode — keeps the aggregator path free of unnecessary requests.
   * Reacts to refreshTrigger so create/upload/delete flows re-render without manual navigation.
   */
  private initRawProjectDocuments(): Signal<ProjectDocument[]> {
    return toSignal(
      combineLatest([toObservable(this.project), toObservable(this.useProjectSource), toObservable(this.refreshTrigger)]).pipe(
        switchMap(([project, useProjectSource]) => {
          if (!useProjectSource || !project?.uid) {
            return of([] as ProjectDocument[]);
          }
          this.loading.set(true);
          return this.projectService.getProjectDocuments(project.uid).pipe(
            catchError(() => of([] as ProjectDocument[])),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] as ProjectDocument[] }
    );
  }

  /**
   * Aggregator-fed documents (Me / Org lens, or no project context). Existing behavior —
   * queries legacy committee_link, mailing-list, meeting-attachment indexed sources.
   * Skipped entirely when in project mode (returns []).
   */
  private initLegacyDocuments(): Signal<MyDocumentItem[]> {
    return toSignal(
      combineLatest([toObservable(this.project), toObservable(this.useProjectSource), toObservable(this.refreshTrigger)]).pipe(
        switchMap(([project, useProjectSource]) => {
          if (useProjectSource) return of([] as MyDocumentItem[]);
          this.loading.set(true);
          return this.documentService.getMyDocuments(project?.uid).pipe(
            catchError(() => of([] as MyDocumentItem[])),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] as MyDocumentItem[] }
    );
  }

  /**
   * Returns the table-facing document list. In project mode, derives a folder-aware
   * view from rawProjectDocuments + currentFolderUid (mirrors CommitteeDocumentsComponent):
   *   - Root view: folders first (with childCount), then orphan items.
   *   - Folder view: only direct children of the selected folder.
   * In legacy mode, returns the aggregator output unchanged.
   */
  private initDocuments(): Signal<MyDocumentItem[]> {
    return computed(() => {
      if (!this.useProjectSource()) {
        return this.legacyDocuments();
      }
      return this.deriveProjectDocuments(this.rawProjectDocuments(), this.currentFolderUid(), this.project());
    });
  }

  private deriveProjectDocuments(raw: ProjectDocument[], currentFolderUid: string | null, project: ProjectContext | null): MyDocumentItem[] {
    const folders = raw.filter((d) => d.type === 'folder');
    const nonFolders = raw.filter((d) => d.type !== 'folder');
    const folderUids = new Set(folders.map((f) => f.uid));

    // Folder view — show only direct children of the selected folder.
    // Guard against a stale UID: if the user drilled into a folder and then switched
    // project/foundation context (or the folder was deleted), fall through to the root
    // view instead of rendering an empty table that requires a manual breadcrumb click.
    if (currentFolderUid && folderUids.has(currentFolderUid)) {
      return nonFolders
        .filter((d) => d.parent_uid === currentFolderUid)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => this.toMyDocumentItem(d, project, false));
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
        ...this.toMyDocumentItem(folder, project, false),
        isFolder: true,
        childCount: childCountByFolder.get(folder.uid) ?? 0,
      });
    }

    // Orphans appear after folders so newly uploaded files don't disappear into a missing parent.
    const orphans = nonFolders.filter((d) => !d.parent_uid || !folderUids.has(d.parent_uid)).sort((a, b) => a.name.localeCompare(b.name));
    for (const orphan of orphans) {
      ordered.push(this.toMyDocumentItem(orphan, project, false));
    }

    return ordered;
  }

  /**
   * Maps a ProjectDocument (folder | link | file) to the MyDocumentItem shape the
   * shared lfx-documents-table renders. Folders carry source 'link' as a placeholder
   * (the table renders folders specially via `isFolder`). Files get a `downloadUrl`
   * pointing at the BFF streaming endpoint.
   */
  private toMyDocumentItem(doc: ProjectDocument, project: ProjectContext | null, isChild: boolean): MyDocumentItem {
    const isFile = doc.type === 'file';
    const ownerProjectUid = project?.uid ?? doc.project_uid ?? '';
    const groupName = project?.name ?? '';
    return {
      id: `project_${doc.type}:${doc.uid}`,
      name: doc.name,
      source: (isFile ? 'file' : 'link') as MyDocumentSource,
      foundationName: '',
      foundationUid: undefined,
      groupOrMeetingName: groupName,
      groupOrMeetingUid: ownerProjectUid,
      date: doc.created_at ?? doc.updated_at ?? '',
      url: doc.url,
      attachmentUid: isFile ? doc.uid : undefined,
      fileType: doc.mime_type,
      parentUid: doc.parent_uid,
      isChild,
      downloadUrl: isFile && ownerProjectUid ? `/api/projects/${ownerProjectUid}/documents/${doc.uid}/download` : undefined,
      uploadedBy: doc.uploaded_by,
    };
  }

  private initFolderOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() =>
      this.rawProjectDocuments()
        .filter((doc) => doc.type === 'folder')
        .map((folder) => ({ label: folder.name, value: folder.uid }))
    );
  }

  private initCurrentFolder(): Signal<ProjectDocument | null> {
    return computed(() => {
      const uid = this.currentFolderUid();
      if (!uid) return null;
      return this.rawProjectDocuments().find((d) => d.uid === uid && d.type === 'folder') ?? null;
    });
  }

  private initFilteredDocuments(): Signal<MyDocumentItem[]> {
    return computed(() => {
      const docs = this.documents();
      const query = this.searchQuery().toLowerCase().trim();
      const projectMode = this.useProjectSource();
      const projectSource = this.projectSourceFilter();
      const foundation = this.foundationFilter();
      const group = this.groupFilter();
      const meeting = this.meetingFilter();
      const mailingList = this.mailingListFilter();
      const sourceTab = this.sourceTab();

      return docs.filter((doc) => {
        if (
          query &&
          !doc.name.toLowerCase().includes(query) &&
          !doc.foundationName.toLowerCase().includes(query) &&
          !doc.groupOrMeetingName.toLowerCase().includes(query)
        ) {
          return false;
        }

        if (projectMode) {
          // Folders are structural navigation — never filtered by source.
          if (projectSource && !doc.isFolder && doc.source !== projectSource) return false;
          return true;
        }

        // Legacy aggregator filters (Me / Org lens)
        if (foundation && doc.foundationUid !== foundation) return false;
        if (group && doc.groupOrMeetingUid !== group) return false;
        if (meeting && doc.meetingId !== meeting && doc.pastMeetingId !== meeting) return false;
        if (mailingList && doc.mailingListId !== mailingList) return false;
        if (sourceTab !== 'all') {
          if (doc.source !== sourceTab && !(sourceTab === 'meeting' && MEETING_GROUP_SOURCES.includes(doc.source))) return false;
        }
        return true;
      });
    });
  }

  private initFoundationOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const docs = this.documents();
      const seen = new Map<string, string>();

      for (const doc of docs) {
        if (doc.foundationUid && doc.foundationName && !seen.has(doc.foundationUid)) {
          seen.set(doc.foundationUid, doc.foundationName);
        }
      }

      const options: { label: string; value: string | null }[] = [{ label: 'All Foundations', value: null }];
      for (const [uid, name] of seen) {
        options.push({ label: name, value: uid });
      }
      return options;
    });
  }

  private initGroupOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const docs = this.documents();
      const foundation = this.foundationFilter();
      const seen = new Map<string, string>();

      for (const doc of docs) {
        if (doc.source !== 'link' && doc.source !== 'mailing_list') continue;
        if (foundation && doc.foundationUid !== foundation) continue;
        if (doc.groupOrMeetingUid && doc.groupOrMeetingName && !seen.has(doc.groupOrMeetingUid)) {
          seen.set(doc.groupOrMeetingUid, doc.groupOrMeetingName);
        }
      }

      const options: { label: string; value: string | null }[] = [{ label: 'All Groups', value: null }];
      for (const [uid, name] of seen) {
        options.push({ label: name, value: uid });
      }
      return options;
    });
  }

  private initMeetingOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const docs = this.documents();
      const meetingLinkedSources = new Set<MyDocumentSource>(['meeting', 'file', 'recording', 'transcript', 'summary']);
      const seen = new Map<string, string>();

      for (const doc of docs) {
        if (!meetingLinkedSources.has(doc.source)) continue;
        const id = doc.meetingId || doc.pastMeetingId;
        if (id && !seen.has(id)) {
          seen.set(id, doc.groupOrMeetingName || id);
        }
      }

      const options: { label: string; value: string | null }[] = [{ label: 'All Meetings', value: null }];
      for (const [id, name] of seen) {
        options.push({ label: name, value: id });
      }
      return options;
    });
  }

  private initMailingListOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const docs = this.documents();
      const seen = new Map<string, string>();

      for (const doc of docs) {
        if (doc.source !== 'mailing_list') continue;
        if (doc.mailingListId && !seen.has(doc.mailingListId)) {
          seen.set(doc.mailingListId, doc.groupOrMeetingName || doc.mailingListId);
        }
      }

      const options: { label: string; value: string | null }[] = [{ label: 'All Mailing Lists', value: null }];
      for (const [id, name] of seen) {
        options.push({ label: name, value: id });
      }
      return options;
    });
  }

  /**
   * Opens the project document form in the requested mode. On a successful create/upload
   * (dialog closes with truthy result) bumps `refreshTrigger` so `initDocuments()` refetches.
   * No-op when there's no active project context.
   */
  private openDocumentDialog(mode: DocumentFormMode, header: string): void {
    const projectUid = this.project()?.uid;
    if (!projectUid) return;

    const dialogRef: DynamicDialogRef | null = this.dialogService.open(DocumentFormComponent, {
      header,
      width: '560px',
      modal: true,
      closable: true,
      data: {
        mode,
        entityType: 'project',
        entityId: projectUid,
        folders: this.folderOptions(),
        // Pre-select the folder the user is currently inside so new file/link lands here
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
}
