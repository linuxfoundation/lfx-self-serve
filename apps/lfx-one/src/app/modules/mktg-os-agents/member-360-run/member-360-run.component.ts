// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatDate, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { MessageComponent } from '@components/message/message.component';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MktgBreadcrumbComponent } from '../components/mktg-breadcrumb/mktg-breadcrumb.component';
import {
  MEMBER_360_INTRO,
  MKTG_RUN_ACTIVE_DIALOG_KEYS,
  MKTG_RUN_RESUME_QUERY_CLEAR,
  MEMBER_360_MAX_BYTES,
  MEMBER_360_MAX_TRACKERS,
  MEMBER_360_WINDOW_OPTIONS,
  MEMBER_360_COMPARISON_UNAVAILABLE,
  MEMBER_360_TRACKER_FILENAME_REGEX,
  MEMBER_360_TRACKER_TYPE_ERROR,
  MEMBER_360_TRACKER_FILENAME_ERROR,
  MEMBER_360_TRACKER_EXTENSION_REGEX,
} from '@lfx-one/shared/constants';
import { readMktgActiveRunConflict, mktgKitRootPath } from '@lfx-one/shared/utils';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { Member360Envelope, Member360GenerateRequest, Member360Session, Member360TrackerUpload, MktgDocumentListItem } from '@lfx-one/shared/interfaces';
import { Member360Service } from '@services/member-360.service';
import { MktgActiveRunGuardService } from '@services/mktg-active-run-guard.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { catchError, distinctUntilChanged, firstValueFrom, map, of, switchMap, tap, take } from 'rxjs';

@Component({
  selector: 'lfx-member-360-run',
  imports: [
    ConfirmDialogModule,
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    SelectComponent,
    FileUploadComponent,
    MessageComponent,
    MktgBreadcrumbComponent,
  ],
  templateUrl: './member-360-run.component.html',
  styleUrl: './member-360-run.component.scss',
})
export class Member360RunComponent {
  private readonly chooser = viewChild(FileUploadComponent);
  private readonly api = inject(Member360Service);
  private readonly documents = inject(MktgDocumentStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly users = inject(UserService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly activeRunGuard = inject(MktgActiveRunGuardService);
  protected readonly conflictKey = MKTG_RUN_ACTIVE_DIALOG_KEYS.member360;
  protected readonly context = inject(ProjectContextService);
  protected readonly intro = MEMBER_360_INTRO;
  protected readonly trackerMaxBytes = MEMBER_360_MAX_BYTES;
  protected readonly windowOptions = MEMBER_360_WINDOW_OPTIONS.map((option) => ({
    ...option,
    label: option.value === 'year' ? `Calendar year ${new Date().getUTCFullYear()}` : option.label,
  }));
  public readonly form = new FormGroup({
    window: new FormControl<NonNullable<Member360GenerateRequest['window']>>('12', { nonNullable: true }),
    compare: new FormControl(true, { nonNullable: true }),
    trackers: new FormControl<Member360TrackerUpload[]>([], { nonNullable: true }),
  });
  protected readonly latest = signal<Member360Envelope | null>(null);
  protected readonly history = signal<MktgDocumentListItem[]>([]);
  protected readonly historyLoading = signal(true);
  protected readonly historyError = signal('');
  protected readonly error = signal('');
  protected readonly uploading = signal(false);
  protected readonly submitting = signal(false);
  private readonly historyRetry = signal(0);
  protected readonly trackers = toSignal(this.form.controls.trackers.valueChanges, { initialValue: this.form.controls.trackers.value });
  protected readonly latestPeriod = computed(() => this.latest()?.period.label.replace(/^(\d{4})-(Q[1-4])$/, '$2 $1') ?? '');
  protected readonly compareOptions = this.initCompareOptions();
  protected readonly projectParams = computed(() => ({ project: this.context.activeContext()?.slug ?? null }));
  private lastScope = '';
  private scopeVersion = 0;
  private uploadSequence = 0;
  private nextTrackerId = 0;
  private readonly scope$ = toObservable(
    computed(() => ({ project: this.context.activeContextUid(), user: this.users.user()?.sub ?? '', retry: this.historyRetry() }))
  );

  public constructor() {
    this.destroyRef.onDestroy(() => this.uploadSequence++);
    if (isPlatformBrowser(this.platformId)) {
      this.scope$
        .pipe(
          distinctUntilChanged((a, b) => a.project === b.project && a.user === b.user && a.retry === b.retry),
          tap(({ project, user }) => {
            const scope = JSON.stringify([project, user]);
            if (scope !== this.lastScope) {
              this.scopeVersion++;
              this.confirmation.close();
              this.form.controls.trackers.setValue([]);
              this.chooser()?.clear();
              this.error.set('');
              this.submitting.set(false);
              this.uploadSequence++;
              this.uploading.set(false);
            }
            this.lastScope = scope;
            this.history.set([]);
            this.latest.set(null);
            this.historyError.set('');
            this.historyLoading.set(true);
            this.form.controls.compare.disable({ emitEvent: false });
          }),
          switchMap(({ project }) =>
            project
              ? this.documents.listDocuments(project).pipe(
                  switchMap((result) => {
                    const group = result.groups.find((candidate) => candidate.type.agentKey === 'member-360');
                    const last = group?.documents[0];
                    if (!group || !last) return of([]);
                    return this.documents.getRevision(project, group.type.agentKey, last.documentId, last.latestRevisionId).pipe(
                      map((view) => {
                        this.latest.set(view.member360 ?? null);
                        if (!view.member360) this.historyError.set('Previous run details could not be loaded. Retry before comparing.');
                        return group.documents;
                      })
                    );
                  }),
                  catchError(() => {
                    this.historyError.set('Run history could not be loaded. Retry before comparing with the previous run.');
                    return of([]);
                  })
                )
              : of([])
          ),
          takeUntilDestroyed()
        )
        .subscribe((history) => {
          this.history.set(history);
          if (!this.latest() && !this.historyError()) this.form.controls.compare.setValue(false, { emitEvent: false });
          this.historyLoading.set(false);
          this.form.controls.compare.enable({ emitEvent: false });
        });
    }
  }

  protected retryHistory(): void {
    this.historyRetry.update((value) => value + 1);
  }

  protected run(): void {
    const project = this.context.activeContextUid();
    const user = this.users.user()?.sub;
    if (!project || !this.context.canWrite() || this.submitting()) return;
    if (this.uploading()) {
      this.error.set('Wait for your trackers to finish parsing, then create Member 360.');
      return;
    }
    if (this.historyLoading()) {
      this.error.set('Wait for run history to finish loading, then create Member 360.');
      return;
    }
    if (this.form.controls.compare.value && (this.historyError() || !this.latest())) {
      this.error.set(
        this.historyError()
          ? 'The previous run could not be read. Choose No comparison or retry history.'
          : 'There is no previous run to compare with. Choose No comparison to create Member 360.'
      );
      return;
    }
    this.submitting.set(true);
    this.error.set('');
    const body: Member360GenerateRequest = {
      project,
      window: this.form.controls.window.value,
      compare: this.form.controls.compare.value,
      trackers: this.trackers().map((upload) => upload.tracker),
    };
    const version = this.scopeVersion;
    const current = () =>
      version === this.scopeVersion && !this.destroyRef.destroyed && project === this.context.activeContextUid() && user === this.users.user()?.sub;
    const onSession = (session: Member360Session) => {
      if (!current()) return;
      this.router.navigate(['../documents/member-360', session.documentId], {
        relativeTo: this.route,
        queryParams: { revision: null, generation: null, run: session.runId ?? null },
        queryParamsHandling: 'merge',
      });
    };
    const start = (discard?: string) => {
      if (!current()) return;
      this.submitting.set(true);
      this.api
        .generate(discard ? { ...body, discard } : body)
        .pipe(take(1))
        .subscribe({
          next: onSession,
          error: (error: HttpErrorResponse) => {
            if (!current()) return;
            this.submitting.set(false);
            const conflict = error.status === 409 ? readMktgActiveRunConflict(error.error, 'member-360') : null;
            if (conflict) {
              this.activeRunGuard.open(
                this.confirmation,
                {
                  conflict,
                  current,
                  recheck: () => this.api.generate(body),
                  classify: (failure) =>
                    failure instanceof HttpErrorResponse && failure.status === 409 ? readMktgActiveRunConflict(failure.error, 'member-360') : null,
                  onValue: onSession,
                  onDiscard: (fresh) => start(fresh.activeRunId),
                  onOpen: (fresh) => {
                    void this.router.navigate([mktgKitRootPath(this.router.url), 'documents', fresh.agentKey, fresh.documentId], {
                      queryParams: { project: this.context.activeContext()?.slug, ...MKTG_RUN_RESUME_QUERY_CLEAR, run: fresh.activeRunId },
                    });
                  },
                  onError: () => {
                    this.submitting.set(false);
                    this.error.set('The start could not be confirmed. Check Documents before trying again.');
                  },
                },
                this.destroyRef,
                this.conflictKey
              );
              return;
            }
            let message = 'The run could not be started. Your trackers are still here; try again.';
            if (error.status === 403) message = 'You need write access to this project to run Member 360.';
            if (error.error?.code === MEMBER_360_COMPARISON_UNAVAILABLE) message = 'The previous run could not be read. Turn off comparison or retry.';
            this.error.set(message);
          },
        });
    };
    start();
  }

  protected rejectUnsupportedTrackers(selected: ArrayLike<File>): boolean {
    const files = Array.from(selected);
    const invalidType = files.some((file) => !MEMBER_360_TRACKER_EXTENSION_REGEX.test(file.name));
    const invalidName = files.some((file) => !MEMBER_360_TRACKER_FILENAME_REGEX.test(file.name));
    if (!invalidType && !invalidName) return false;
    this.error.set(invalidType ? MEMBER_360_TRACKER_TYPE_ERROR : MEMBER_360_TRACKER_FILENAME_ERROR);
    this.chooser()?.clear(true);
    return true;
  }

  protected async upload(selected: File[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.rejectUnsupportedTrackers(selected)) return;
    const files = [...selected];
    const attempt = ++this.uploadSequence;
    this.uploading.set(true);
    this.error.set('');
    try {
      if (files.length + this.trackers().length > MEMBER_360_MAX_TRACKERS) throw new Error(`Upload at most ${MEMBER_360_MAX_TRACKERS} tracker files.`);
      const project = this.context.activeContextUid();
      const parsed: Member360TrackerUpload[] = [];
      for (const file of files) {
        if (attempt !== this.uploadSequence) return;
        if (file.size > MEMBER_360_MAX_BYTES) throw new Error('Each tracker must be smaller than 5 MB.');
        const tracker = await firstValueFrom(this.api.parseTracker(project, file));
        parsed.push({
          id: ++this.nextTrackerId,
          tracker,
          format: /\.xlsx$/i.test(file.name) ? 'XLSX' : 'CSV',
          summary: Object.keys(tracker.rows[0] ?? {})
            .slice(0, 3)
            .join(', '),
        });
      }
      const combined = [...this.trackers(), ...parsed];
      if (new TextEncoder().encode(JSON.stringify(combined.map((upload) => upload.tracker))).length > MEMBER_360_MAX_BYTES)
        throw new Error('The parsed trackers together must be smaller than 5 MB.');
      if (attempt === this.uploadSequence) this.form.controls.trackers.setValue(combined);
    } catch (error) {
      let message = 'The tracker could not be parsed.';
      if (error instanceof Error) message = error.message;
      if (error instanceof HttpErrorResponse)
        message = getHttpErrorDetail(error, 'The tracker could not be parsed. Check its format and limits, and try again.');
      if (attempt === this.uploadSequence) this.error.set(message);
    } finally {
      if (attempt === this.uploadSequence) {
        this.uploading.set(false);
        this.chooser()?.clear(true);
      }
    }
  }

  protected remove(id: number): void {
    this.form.controls.trackers.setValue(this.trackers().filter((upload) => upload.id !== id));
  }
  private initCompareOptions() {
    return computed(() => {
      const latest = this.latest();
      let label = 'No previous run yet';
      if (this.historyLoading()) label = 'Loading previous run…';
      if (this.historyError()) label = 'Previous run details unavailable';
      if (latest) label = `Previous run: ${this.latestPeriod()} (${formatDate(latest.generated_at, 'd MMM', 'en-US', 'UTC')}) — trend arrows`;
      return [
        { value: true, label },
        { value: false, label: 'No comparison' },
      ];
    });
  }
}
