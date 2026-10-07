// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { SelectComponent } from '@components/select/select.component';
import {
  formFromImportedMentorshipProgram,
  isMentorshipProgramImportable,
  MENTORSHIP_CII_APPLY_URL,
  MENTORSHIP_CII_CHECKING,
  MENTORSHIP_CII_INTRO,
  MENTORSHIP_CII_INVALID_ID,
  MENTORSHIP_CII_UNAVAILABLE,
  MENTORSHIP_CODE_OF_CONDUCT_TEMPLATE_URL,
  MENTORSHIP_ENROLL_COC_INTRO,
  MENTORSHIP_ENROLL_DETAILS_INTRO,
  MENTORSHIP_ENROLL_DESCRIPTION_MAX,
  MENTORSHIP_ENROLL_LOGO_ACCEPT,
  MENTORSHIP_ENROLL_LOGO_HELPER,
  MENTORSHIP_ENROLL_NAME_CHECKING,
  MENTORSHIP_ENROLL_NAME_MAX,
  MENTORSHIP_ENROLL_NAME_MIN,
  MENTORSHIP_ENROLL_NAME_TAKEN,
  MENTORSHIP_ENROLL_NAME_UNAVAILABLE,
  MENTORSHIP_ENROLL_REPO_HELPER,
  MENTORSHIP_ENROLL_WEBSITE_HELPER,
  MENTORSHIP_ENROLL_PROJECTS_EMPTY_MESSAGE,
  MENTORSHIP_ENROLL_PROJECTS_SEARCHING_MESSAGE,
  MENTORSHIP_ENROLL_PROJECTS_UNAVAILABLE,
  MENTORSHIP_LF_PROJECT_MAX_AUTO_FOLLOWS,
  MENTORSHIP_LF_PROJECT_PAGE_SIZE,
  MENTORSHIP_LF_PROJECT_REMOTE_FILTER_FIELD,
  MENTORSHIP_MENTOR_PICKER_LIST_PADDING,
  MENTORSHIP_MENTOR_PICKER_MAX_HEIGHT,
  MENTORSHIP_MENTOR_PICKER_SCROLLER_OPTIONS,
  MENTORSHIP_PROGRAMS_MAX_LIMIT,
  MENTORSHIP_SKILL_OPTIONS,
  mentorshipCiiBadgeImageUrl,
  mentorshipCiiProjectUrl,
} from '@lfx-one/shared/constants';
import { MentorshipCiiLookupStatus, MentorshipEnrollFieldErrors, MentorshipLfProject, MentorshipNameLookupStatus } from '@lfx-one/shared/interfaces';
import { getMentorshipEnrollLogoError, isMentorshipCiiProjectId, isMentorshipRichTextOverRawMax, mentorshipDescriptionLength } from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MentorshipService } from '@services/mentorship.service';
import { OverlayOptions } from 'primeng/api';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  map,
  merge,
  mergeMap,
  of,
  share,
  startWith,
  Subject,
  switchMap,
  takeUntil,
  tap,
  timer,
} from 'rxjs';

@Component({
  selector: 'lfx-mentorship-enroll-details-step',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent, RichEditorComponent, ButtonComponent],
  templateUrl: './enroll-details-step.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollDetailsStepComponent {
  public readonly form = input.required<FormGroup>();
  public readonly errors = input<MentorshipEnrollFieldErrors>({});
  /** The project chosen in the picker; the wizard needs its slug and name to create the program. */
  public readonly project = model<MentorshipLfProject | null>(null);
  /** The picked logo file; the form keeps only its name and preview, and the wizard uploads this after the create. */
  public readonly logoFile = model<File | null>(null);
  public readonly ciiLookupStatusChange = output<MentorshipCiiLookupStatus>();
  public readonly nameLookupStatusChange = output<MentorshipNameLookupStatus>();

  private readonly mentorshipService = inject(MentorshipService);
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly lfFilter$ = new Subject<string>();
  private readonly lfLoadMore$ = new Subject<void>();
  private readonly lfFirstPageRetry$ = new Subject<void>();
  protected readonly lfProjectItemSize = 40;
  protected readonly lfRemoteFilterField = MENTORSHIP_LF_PROJECT_REMOTE_FILTER_FIELD;
  protected readonly lfScrollerOptions = MENTORSHIP_MENTOR_PICKER_SCROLLER_OPTIONS;
  /** On close the select clears its filter box (`resetFilterOnHide`); this clears the search behind it. */
  protected readonly lfOverlayOptions: OverlayOptions = { onBeforeHide: () => this.onLfFilter({ filter: '' }) };

  protected readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  protected readonly logoError = signal('');
  protected readonly importLoading = signal(true);
  protected readonly importOptions = signal<{ value: string; label: string }[]>([{ value: '', label: 'None' }]);
  protected readonly lfProjects = signal<MentorshipLfProject[]>([]);
  protected readonly lfProjectsLoading = signal(false);
  /** Cursor for the next lazy-load page; null once every project has been loaded. */
  protected readonly lfNextPageToken = signal<string | null>(null);
  /** A page read failed; Retry rereads whichever page failed. */
  protected readonly lfProjectsFailed = signal(false);
  private readonly nameLookupRetry = signal(0);
  private readonly ciiLookupRetry = signal(0);
  /** True from a keystroke that changes the search until its read starts, so the debounce never looks like "no results". */
  private readonly lfSearchPending = signal(false);
  private lfSearch = '';
  /** Short-page cursors followed without a scroll since the current search's first page. */
  private lfAutoFollows = 0;

  protected readonly draftTechForm = new FormGroup({
    technology: new FormControl('', { nonNullable: true }),
  });

  protected readonly intro = MENTORSHIP_ENROLL_DETAILS_INTRO;
  protected readonly nameMax = MENTORSHIP_ENROLL_NAME_MAX;
  protected readonly descriptionMax = MENTORSHIP_ENROLL_DESCRIPTION_MAX;
  protected readonly logoAccept = MENTORSHIP_ENROLL_LOGO_ACCEPT;
  protected readonly logoHelper = MENTORSHIP_ENROLL_LOGO_HELPER;
  protected readonly repoHelper = MENTORSHIP_ENROLL_REPO_HELPER;
  protected readonly websiteHelper = MENTORSHIP_ENROLL_WEBSITE_HELPER;
  protected readonly cocIntro = MENTORSHIP_ENROLL_COC_INTRO;
  protected readonly ciiApplyUrl = MENTORSHIP_CII_APPLY_URL;
  protected readonly ciiIntro = MENTORSHIP_CII_INTRO;
  protected readonly ciiInvalidId = MENTORSHIP_CII_INVALID_ID;
  protected readonly ciiUnavailable = MENTORSHIP_CII_UNAVAILABLE;
  protected readonly ciiChecking = MENTORSHIP_CII_CHECKING;
  protected readonly nameChecking = MENTORSHIP_ENROLL_NAME_CHECKING;
  protected readonly nameTaken = MENTORSHIP_ENROLL_NAME_TAKEN;
  protected readonly nameUnavailable = MENTORSHIP_ENROLL_NAME_UNAVAILABLE;
  protected readonly projectsUnavailable = MENTORSHIP_ENROLL_PROJECTS_UNAVAILABLE;
  protected readonly codeOfConductTemplateUrl = MENTORSHIP_CODE_OF_CONDUCT_TEMPLATE_URL;

  protected readonly draftTechnology = toSignal(this.draftTechForm.controls.technology.valueChanges, { initialValue: '' });

  private readonly formSnapshot = toSignal(toObservable(this.form).pipe(switchMap((group) => group.valueChanges.pipe(startWith(group.getRawValue())))), {
    initialValue: {} as Record<string, unknown>,
  });

  protected readonly nameLength = computed(() => String(this.formSnapshot()['name'] ?? this.form().controls['name']?.value ?? '').length);
  private readonly descriptionHtml = computed(() => String(this.formSnapshot()['description'] ?? this.form().controls['description']?.value ?? ''));
  protected readonly descriptionTooLarge = computed(() => isMentorshipRichTextOverRawMax(this.descriptionHtml()));
  protected readonly descriptionLength = computed(() => mentorshipDescriptionLength(this.descriptionHtml()));
  protected readonly technologies = computed(() => {
    const fromSnapshot = this.formSnapshot()['technologies'];
    if (Array.isArray(fromSnapshot)) return fromSnapshot as string[];
    return (this.form().controls['technologies']?.value as string[]) ?? [];
  });
  protected readonly logoFileName = computed(() => String(this.formSnapshot()['logoFileName'] ?? this.form().controls['logoFileName']?.value ?? ''));
  protected readonly logoPreviewUrl = computed(() => String(this.formSnapshot()['logoPreviewUrl'] ?? this.form().controls['logoPreviewUrl']?.value ?? ''));
  protected readonly lfEmptyMessage = computed(() =>
    this.lfSearchPending() || this.lfProjectsLoading() ? MENTORSHIP_ENROLL_PROJECTS_SEARCHING_MESSAGE : MENTORSHIP_ENROLL_PROJECTS_EMPTY_MESSAGE
  );
  /** Sized from the rows so a short list does not scroll and a list that grew after an empty one is not left a few px tall. */
  protected readonly lfScrollHeight = computed(() => {
    const rows = Math.max(1, this.projectOptions().length) * this.lfProjectItemSize;
    return `min(${MENTORSHIP_MENTOR_PICKER_MAX_HEIGHT}px, calc(${rows}px + ${MENTORSHIP_MENTOR_PICKER_LIST_PADDING}))`;
  });
  protected readonly projectOptions = computed(() => {
    const selectedId = String(this.formSnapshot()['projectId'] ?? this.form().controls['projectId']?.value ?? '');
    const loaded = this.lfProjects();
    const options = loaded.map((project) => ({ ...project, value: project.id, label: project.name }));
    if (selectedId && !options.some((option) => option.value === selectedId)) {
      const remembered = this.resolveSelectedProject(selectedId, loaded);
      const label = remembered?.name ?? selectedId;
      options.unshift({ id: selectedId, name: label, slug: remembered?.slug ?? '', value: selectedId, label, logoUrl: remembered?.logoUrl });
    }
    return options;
  });

  protected readonly availableTechnologies = computed(() => {
    const selected = new Set(this.technologies().map((item) => item.toLowerCase()));
    return MENTORSHIP_SKILL_OPTIONS.filter((tech) => !selected.has(tech.toLowerCase())).map((tech) => ({ label: tech, value: tech }));
  });

  private readonly ciiProjectId = computed(() => String(this.formSnapshot()['ciiProjectId'] ?? this.form().controls['ciiProjectId']?.value ?? '').trim());
  private readonly programName = computed(() => String(this.formSnapshot()['name'] ?? this.form().controls['name']?.value ?? '').trim());

  protected readonly ciiLookup = toSignal(
    toObservable(computed(() => ({ projectId: this.ciiProjectId(), retry: this.ciiLookupRetry() }))).pipe(
      switchMap(({ projectId }) => {
        if (!projectId) return of({ status: 'idle' as const, projectId: '' });
        if (!isMentorshipCiiProjectId(projectId)) return of({ status: 'invalid' as const, projectId });
        return timer(300).pipe(
          switchMap(() => this.mentorshipService.getCiiBadge(projectId)),
          map((badge) => (badge ? { status: 'valid' as const, projectId: badge.projectId } : { status: 'invalid' as const, projectId })),
          catchError(() => of({ status: 'unavailable' as const, projectId })),
          startWith({ status: 'loading' as const, projectId })
        );
      })
    ),
    { initialValue: { status: 'idle' as MentorshipCiiLookupStatus, projectId: '' } }
  );

  protected readonly nameLookup = toSignal(
    toObservable(computed(() => ({ name: this.programName(), retry: this.nameLookupRetry() }))).pipe(
      switchMap(({ name }) => {
        if (name.length < MENTORSHIP_ENROLL_NAME_MIN) return of({ status: 'idle' as const });
        return timer(300).pipe(
          switchMap(() => this.mentorshipService.isProgramNameAvailable(name)),
          map((result) => ({ status: result.available ? ('available' as const) : ('taken' as const) })),
          catchError(() => of({ status: 'unavailable' as const })),
          startWith({ status: 'loading' as const })
        );
      })
    ),
    { initialValue: { status: 'idle' as MentorshipNameLookupStatus } }
  );

  protected readonly ciiBadgeImageUrl = computed(() => {
    const lookup = this.ciiLookup();
    return lookup.status === 'valid' && lookup.projectId ? mentorshipCiiBadgeImageUrl(lookup.projectId) : '';
  });

  protected readonly ciiProjectHref = computed(() => {
    const lookup = this.ciiLookup();
    return lookup.status === 'valid' && lookup.projectId ? mentorshipCiiProjectUrl(lookup.projectId) : '';
  });

  public constructor() {
    toObservable(this.ciiLookup)
      .pipe(takeUntilDestroyed())
      .subscribe((lookup) => this.ciiLookupStatusChange.emit(lookup.status));
    toObservable(this.nameLookup)
      .pipe(takeUntilDestroyed())
      .subscribe((lookup) => this.nameLookupStatusChange.emit(lookup.status));

    toObservable(computed(() => String(this.formSnapshot()['projectId'] ?? this.form().controls['projectId']?.value ?? '')))
      .pipe(takeUntilDestroyed())
      .subscribe((projectId) => this.rememberSelectedProject(projectId));

    toObservable(this.lfProjects)
      .pipe(takeUntilDestroyed())
      .subscribe((projects) => {
        const projectId = String(this.form().controls['projectId']?.value ?? '');
        const found = projects.find((project) => project.id === projectId);
        if (found) this.project.set(found);
      });

    this.mentorshipAdminService
      .getPrograms({ limit: MENTORSHIP_PROGRAMS_MAX_LIMIT })
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (response) => {
          this.importOptions.set([
            { value: '', label: 'None' },
            ...response.data.filter((program) => isMentorshipProgramImportable(program.id)).map((program) => ({ value: program.id, label: program.name })),
          ]);
          this.importLoading.set(false);
        },
        error: () => this.importLoading.set(false),
      });

    const search$ = this.lfFilter$.pipe(debounceTime(300), startWith(''), distinctUntilChanged(), share());

    // Retry rereads the current search; search$ alone would not, since distinctUntilChanged drops a repeat of it.
    const firstPage$ = merge(search$, this.lfFirstPageRetry$.pipe(map(() => this.lfSearch))).pipe(
      tap((search) => {
        this.lfSearch = search;
        this.lfSearchPending.set(false);
        this.lfAutoFollows = 0;
        this.lfProjectsLoading.set(true);
        this.lfProjectsFailed.set(false);
      }),
      switchMap((search) =>
        this.mentorshipService.getLfProjects({ search, limit: MENTORSHIP_LF_PROJECT_PAGE_SIZE }).pipe(
          map((response) => ({ ...response, append: false as const, requestedToken: null })),
          catchError(() => {
            // Empty the list so the picker does not keep the previous search's projects under the failure.
            this.lfProjects.set([]);
            this.lfNextPageToken.set(null);
            this.failLfPage();
            return EMPTY;
          })
        )
      )
    );

    // mergeMap, not exhaustMap: a short page asks for the next one while its own read is still finishing, and the
    // lfProjectsLoading guard below already keeps two page reads from overlapping.
    const nextPage$ = this.lfLoadMore$.pipe(
      mergeMap(() => {
        const pageToken = this.lfNextPageToken();
        if (this.lfProjectsLoading() || !pageToken) return EMPTY;
        this.lfProjectsLoading.set(true);
        this.lfProjectsFailed.set(false);
        return this.mentorshipService.getLfProjects({ search: this.lfSearch, pageToken, limit: MENTORSHIP_LF_PROJECT_PAGE_SIZE }).pipe(
          takeUntil(search$),
          map((response) => ({ ...response, append: true as const, requestedToken: pageToken })),
          // The cursor stays, so Retry asks for the same page again.
          catchError(() => {
            this.failLfPage();
            return EMPTY;
          })
        );
      })
    );

    // nextPage$ subscribes first so lfLoadMore$ is already listened to when the first page asks to follow its cursor.
    merge(nextPage$, firstPage$)
      .pipe(takeUntilDestroyed())
      .subscribe((page) => {
        this.lfProjects.set(page.append ? [...this.lfProjects(), ...page.data] : page.data);
        // A cursor that came back unchanged would only replay the same page, by scroll or by the follow below, so treat it as the end.
        const nextPageToken = !page.page_token || page.page_token === page.requestedToken ? null : page.page_token;
        this.lfNextPageToken.set(nextPageToken);
        this.lfProjectsLoading.set(false);
        // Pages that access filtering left short may not fill the scroller enough to fire onLazyLoad, so follow the cursor here
        // while less than a page is loaded, a bounded number of times so a sparse catalog is not walked to its end on open.
        if (nextPageToken && this.lfProjects().length < MENTORSHIP_LF_PROJECT_PAGE_SIZE && this.lfAutoFollows < MENTORSHIP_LF_PROJECT_MAX_AUTO_FOLLOWS) {
          this.lfAutoFollows++;
          this.lfLoadMore$.next();
        }
      });
  }

  protected retryNameLookup(): void {
    this.nameLookupRetry.update((count) => count + 1);
  }

  protected retryCiiLookup(): void {
    this.ciiLookupRetry.update((count) => count + 1);
  }

  protected retryLfProjects(): void {
    // A failed first page cleared the cursor; a failed later page kept it.
    if (!this.lfNextPageToken()) {
      this.lfFirstPageRetry$.next();
      return;
    }
    this.lfLoadMore$.next();
  }

  protected onImportProgram(): void {
    const importId = (this.form().controls['importProgramId']?.value as string) ?? '';
    this.revokeLogoPreview();
    const fileEl = this.fileInput()?.nativeElement;
    if (fileEl) fileEl.value = '';
    this.form().patchValue(formFromImportedMentorshipProgram(importId));
    this.logoFile.set(null);
    this.logoError.set('');
  }

  protected onLfFilter(event: { filter?: string }): void {
    const search = (event.filter ?? '').trim();
    this.lfSearchPending.set(search !== this.lfSearch);
    this.lfFilter$.next(search);
  }

  /** The virtual scroller's lazy-load: fetches the next page once the rendered window nears the end of what is loaded. */
  protected onLfLazyLoad(event?: { last?: number }): void {
    // After a failure only Retry reads again, so scrolling cannot hammer a failing upstream.
    if (this.lfProjectsLoading() || this.lfProjectsFailed() || !this.lfNextPageToken()) return;
    if (event?.last !== undefined && event.last < this.lfProjects().length - 1) return;
    this.lfLoadMore$.next();
  }

  protected addTechnology(): void {
    const value = this.draftTechForm.controls.technology.value.trim();
    if (!value) return;
    const current = this.technologies();
    if (current.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    this.form().controls['technologies'].setValue([...current, value]);
    this.draftTechForm.controls.technology.setValue('');
  }

  protected removeTechnology(tech: string): void {
    this.form().controls['technologies'].setValue(this.technologies().filter((item) => item !== tech));
  }

  protected onBrowseLogo(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected onLogoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.logoError.set('');
    if (!file) {
      this.clearLogo();
      return;
    }
    const fileError = getMentorshipEnrollLogoError(file);
    if (fileError) {
      this.logoError.set(fileError);
      input.value = '';
      this.clearLogo();
      return;
    }
    this.revokeLogoPreview();
    this.logoFile.set(file);
    this.form().patchValue({
      logoFileName: file.name,
      logoPreviewUrl: URL.createObjectURL(file),
    });
  }

  protected projectInitial(name: string): string {
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  private rememberSelectedProject(projectId: string): void {
    if (!projectId) {
      this.project.set(null);
      return;
    }
    // Unresolved ids clear the model rather than keep the previous project; the lfProjects watcher fills it once the id loads.
    this.project.set(this.resolveSelectedProject(projectId, this.lfProjects()) ?? null);
  }

  private resolveSelectedProject(projectId: string, loaded: MentorshipLfProject[]): MentorshipLfProject | undefined {
    const fromLoaded = loaded.find((project) => project.id === projectId);
    if (fromLoaded) return fromLoaded;
    const cached = this.project();
    return cached?.id === projectId ? cached : undefined;
  }

  private failLfPage(): void {
    this.lfProjectsLoading.set(false);
    this.lfProjectsFailed.set(true);
  }

  private clearLogo(): void {
    this.revokeLogoPreview();
    this.logoFile.set(null);
    this.form().patchValue({ logoFileName: '', logoPreviewUrl: '' });
  }

  private revokeLogoPreview(): void {
    const url = this.form().controls['logoPreviewUrl']?.value as string;
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}
