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
import { DocumentService } from '@services/document.service';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, finalize, map, of, startWith, switchMap, take } from 'rxjs';

import { DocumentFormComponent } from '../document-form/document-form.component';

@Component({
  selector: 'lfx-committee-documents',
  imports: [ButtonComponent, CardComponent, InputTextComponent, SelectComponent, DocumentsTableComponent, ReactiveFormsModule],
  providers: [DialogService, MessageService],
  templateUrl: './committee-documents.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeDocumentsComponent {
  // === Services ===
  private readonly documentService = inject(DocumentService);
  private readonly committeeService = inject(CommitteeService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);

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

  // === Static Options ===
  protected readonly sourceOptions: { label: string; value: MyDocumentSource | null }[] = [
    { label: 'All Sources', value: null },
    { label: 'Link', value: 'link' },
    { label: 'Meeting', value: 'meeting' },
    { label: 'Mailing List', value: 'mailing_list' },
  ];

  // === Computed Signals ===
  protected readonly searchQuery: Signal<string> = this.initSearchQuery();
  protected readonly sourceFilter: Signal<MyDocumentSource | null> = this.initSourceFilter();
  protected readonly documents: Signal<MyDocumentItem[]> = this.initDocuments();
  protected readonly filteredDocuments: Signal<MyDocumentItem[]> = this.initFilteredDocuments();
  protected readonly committeeDocuments: Signal<CommitteeDocument[]> = this.initCommitteeDocuments();
  protected readonly folderOptions: Signal<{ label: string; value: string }[]> = this.initFolderOptions();

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

  private initDocuments(): Signal<MyDocumentItem[]> {
    return toSignal(
      combineLatest([toObservable(this.committee), toObservable(this.refreshTrigger)]).pipe(
        switchMap(([committee]) => {
          this.loading.set(true);
          return this.documentService.getMyDocuments(committee.project_uid, committee.uid).pipe(
            catchError(() => of([] as MyDocumentItem[])),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] as MyDocumentItem[] }
    );
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
        if (source && doc.source !== source && !(source === 'meeting' && MEETING_GROUP_SOURCES.includes(doc.source))) {
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
        switchMap(([committee]) => this.committeeService.getCommitteeDocuments(committee.uid))
      ),
      { initialValue: [] as CommitteeDocument[] }
    );
  }

  private initFolderOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() =>
      this.committeeDocuments()
        .filter((doc) => doc.type === 'folder')
        .map((folder) => ({ label: folder.name, value: folder.uid }))
    );
  }
}
