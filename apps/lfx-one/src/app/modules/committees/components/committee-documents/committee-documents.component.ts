// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { DocumentsTableComponent } from '@components/documents-table/documents-table.component';
import { MEETING_GROUP_SOURCES } from '@lfx-one/shared/constants';
import { Committee, MyDocumentItem, MyDocumentSource } from '@lfx-one/shared/interfaces';
import { DocumentService } from '@services/document.service';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, of, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-committee-documents',
  imports: [CardComponent, InputTextComponent, SelectComponent, DocumentsTableComponent, ReactiveFormsModule],
  templateUrl: './committee-documents.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeDocumentsComponent {
  // === Services ===
  private readonly documentService = inject(DocumentService);

  // === Inputs ===
  public readonly committee = input.required<Committee>();

  // === Forms ===
  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(''),
    source: new FormControl<MyDocumentSource | null>(null),
  });

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);

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
      toObservable(this.committee).pipe(
        switchMap((committee) => {
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
}
