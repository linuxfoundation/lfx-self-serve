// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { DocumentsTableComponent } from '@components/documents-table/documents-table.component';
import { DOCUMENT_LABEL, MEETING_GROUP_SOURCES } from '@lfx-one/shared/constants';
import { MyDocumentItem, MyDocumentSource } from '@lfx-one/shared/interfaces';
import { DocumentService } from '@services/document.service';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, map, of, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-documents-dashboard',
  imports: [CardComponent, InputTextComponent, SelectComponent, DocumentsTableComponent, ReactiveFormsModule],
  templateUrl: './documents-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsDashboardComponent {
  // === Services ===
  private readonly documentService = inject(DocumentService);
  private readonly lensService = inject(LensService);
  private readonly projectContextService = inject(ProjectContextService);

  // === Constants ===
  protected readonly documentLabel = DOCUMENT_LABEL;
  protected readonly sourceOptions: { label: string; value: MyDocumentSource | null }[] = [
    { label: 'All Sources', value: null },
    { label: 'Link', value: 'link' },
    { label: 'Meeting', value: 'meeting' },
    { label: 'Mailing List', value: 'mailing_list' },
  ];

  // === Forms ===
  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(''),
    foundation: new FormControl<string | null>(null),
    group: new FormControl<string | null>(null),
    meeting: new FormControl<string | null>(null),
    mailingList: new FormControl<string | null>(null),
    source: new FormControl<MyDocumentSource | null>(null),
  });

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);

  // === Computed Signals ===
  protected readonly isMeLens: Signal<boolean> = computed(() => this.lensService.activeLens() === 'me');
  protected readonly pageTitle = computed(() => (this.isMeLens() ? `My ${this.documentLabel.plural}` : this.documentLabel.plural));
  protected readonly pageDescription = computed(() =>
    this.isMeLens()
      ? 'Documents, links, and attachments from your groups and meetings across all foundations.'
      : 'Documents, links, and attachments for this context.'
  );
  protected readonly project = this.projectContextService.activeContext;
  protected readonly searchQuery: Signal<string> = this.initSearchQuery();
  protected readonly foundationFilter: Signal<string | null> = this.initFoundationFilter();
  protected readonly groupFilter: Signal<string | null> = this.initGroupFilter();
  protected readonly meetingFilter: Signal<string | null> = this.initMeetingFilter();
  protected readonly mailingListFilter: Signal<string | null> = this.initMailingListFilter();
  protected readonly sourceFilter: Signal<MyDocumentSource | null> = this.initSourceFilter();
  protected readonly documents: Signal<MyDocumentItem[]> = this.initDocuments();
  protected readonly filteredDocuments: Signal<MyDocumentItem[]> = this.initFilteredDocuments();
  protected readonly foundationOptions: Signal<{ label: string; value: string | null }[]> = this.initFoundationOptions();
  protected readonly groupOptions: Signal<{ label: string; value: string | null }[]> = this.initGroupOptions();
  protected readonly meetingOptions: Signal<{ label: string; value: string | null }[]> = this.initMeetingOptions();
  protected readonly mailingListOptions: Signal<{ label: string; value: string | null }[]> = this.initMailingListOptions();

  // === Constructor ===
  public constructor() {
    // Reset Me-lens-only filters when switching away from Me lens
    effect(() => {
      if (!this.isMeLens()) {
        this.filterForm.controls.foundation.reset(null);
      }
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

  private initSourceFilter(): Signal<MyDocumentSource | null> {
    return toSignal(this.filterForm.controls.source.valueChanges.pipe(startWith<MyDocumentSource | null>(null)), { initialValue: null });
  }

  private initDocuments(): Signal<MyDocumentItem[]> {
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([toObservable(this.project), lens$]).pipe(
        switchMap(([project, lens]) => {
          // On non-Me lenses, require a project/foundation selection
          if (lens !== 'me' && !project?.uid) {
            this.loading.set(false);
            return of([] as MyDocumentItem[]);
          }

          this.loading.set(true);

          // Me lens: fetch all documents (no project filter)
          // Foundation/Project lens: scope to selected project
          const projectUid = lens === 'me' ? undefined : project?.uid;
          return this.documentService.getMyDocuments(projectUid).pipe(
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
      const source = this.sourceFilter();

      return docs.filter((doc) => {
        if (
          query &&
          !doc.name.toLowerCase().includes(query) &&
          !(doc.foundationName ?? '').toLowerCase().includes(query) &&
          !(doc.groupOrMeetingName ?? '').toLowerCase().includes(query)
        ) {
          return false;
        }
        if (this.isMeLens() && foundation && doc.foundationUid !== foundation) return false;
        if (group && doc.groupOrMeetingUid !== group) return false;
        if (meeting && doc.meetingId !== meeting && doc.pastMeetingId !== meeting) return false;
        if (mailingList && doc.mailingListId !== mailingList) return false;
        if (source && doc.source !== source && !(source === 'meeting' && MEETING_GROUP_SOURCES.includes(doc.source))) return false;
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
