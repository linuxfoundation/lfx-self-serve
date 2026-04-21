// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { DOCUMENT_LABEL, MEETING_GROUP_SOURCES } from '@lfx-one/shared/constants';
import { FilterPillOption, MyDocumentItem, MyDocumentSource } from '@lfx-one/shared/interfaces';
import { DocumentService } from '@services/document.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, of, startWith, switchMap } from 'rxjs';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MyDocumentSourceTagPipe } from '@app/shared/pipes/my-document-source-tag.pipe';

@Component({
  selector: 'lfx-documents-dashboard',
  imports: [
    CardComponent,
    CardTabsBarComponent,
    ButtonComponent,
    InputTextComponent,
    SelectComponent,
    TableComponent,
    TagComponent,
    ReactiveFormsModule,
    DatePipe,
    MyDocumentSourceTagPipe,
    EmptyStateComponent,
  ],
  templateUrl: './documents-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsDashboardComponent {
  // === Services ===
  private readonly documentService = inject(DocumentService);
  private readonly projectContextService = inject(ProjectContextService);

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
    foundation: new FormControl<string | null>(null),
    group: new FormControl<string | null>(null),
    meeting: new FormControl<string | null>(null),
    mailingList: new FormControl<string | null>(null),
  });

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly sourceTab = signal<string>('all');

  // === Computed Signals ===
  protected readonly project = this.projectContextService.activeContext;
  protected readonly searchQuery: Signal<string> = this.initSearchQuery();
  protected readonly foundationFilter: Signal<string | null> = this.initFoundationFilter();
  protected readonly groupFilter: Signal<string | null> = this.initGroupFilter();
  protected readonly meetingFilter: Signal<string | null> = this.initMeetingFilter();
  protected readonly mailingListFilter: Signal<string | null> = this.initMailingListFilter();
  protected readonly documents: Signal<MyDocumentItem[]> = this.initDocuments();
  protected readonly filteredDocuments: Signal<MyDocumentItem[]> = this.initFilteredDocuments();
  protected readonly rppOptions = computed<number[] | undefined>(() => (this.filteredDocuments().length > 10 ? [10, 25, 50] : undefined));
  protected readonly foundationOptions: Signal<{ label: string; value: string | null }[]> = this.initFoundationOptions();
  protected readonly groupOptions: Signal<{ label: string; value: string | null }[]> = this.initGroupOptions();
  protected readonly meetingOptions: Signal<{ label: string; value: string | null }[]> = this.initMeetingOptions();
  protected readonly mailingListOptions: Signal<{ label: string; value: string | null }[]> = this.initMailingListOptions();

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

  private initDocuments(): Signal<MyDocumentItem[]> {
    return toSignal(
      toObservable(this.project).pipe(
        switchMap((project) => {
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

  private initFilteredDocuments(): Signal<MyDocumentItem[]> {
    return computed(() => {
      const docs = this.documents();
      const query = this.searchQuery().toLowerCase().trim();
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
}
