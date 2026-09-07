// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
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
  MENTORSHIP_CODE_OF_CONDUCT_TEMPLATE_URL,
  MENTORSHIP_ENROLL_COC_INTRO,
  MENTORSHIP_ENROLL_DETAILS_INTRO,
  MENTORSHIP_ENROLL_DESCRIPTION_MAX,
  MENTORSHIP_ENROLL_LOGO_ACCEPT,
  MENTORSHIP_ENROLL_LOGO_HELPER,
  MENTORSHIP_ENROLL_LOGO_MAX_BYTES,
  MENTORSHIP_ENROLL_LOGO_TYPE_ERROR,
  MENTORSHIP_ENROLL_NAME_CHECKING,
  MENTORSHIP_ENROLL_NAME_MAX,
  MENTORSHIP_ENROLL_NAME_MIN,
  MENTORSHIP_ENROLL_NAME_TAKEN,
  MENTORSHIP_ENROLL_REPO_HELPER,
  MENTORSHIP_ENROLL_WEBSITE_HELPER,
  MENTORSHIP_LF_PROJECT_PAGE_SIZE,
  MENTORSHIP_SKILL_OPTIONS,
  mentorshipCiiBadgeImageUrl,
  mentorshipCiiProjectUrl,
} from '@lfx-one/shared/constants';
import { MentorshipCiiLookupStatus, MentorshipEnrollFieldErrors, MentorshipLfProject, MentorshipNameLookupStatus } from '@lfx-one/shared/interfaces';
import { isMentorshipCiiProjectId, isMentorshipLogoFileName, mentorshipDescriptionLength } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  exhaustMap,
  map,
  merge,
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
  public readonly ciiLookupStatusChange = output<MentorshipCiiLookupStatus>();
  public readonly nameLookupStatusChange = output<MentorshipNameLookupStatus>();

  private readonly mentorshipService = inject(MentorshipService);
  private readonly lfFilter$ = new Subject<string>();
  private readonly lfLoadMore$ = new Subject<void>();
  protected readonly lfProjectItemSize = 40;

  protected readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  protected readonly logoError = signal('');
  protected readonly importLoading = signal(true);
  protected readonly importOptions = signal<{ value: string; label: string }[]>([{ value: '', label: 'None' }]);
  protected readonly lfProjects = signal<MentorshipLfProject[]>([]);
  protected readonly lfProjectsLoading = signal(false);
  protected readonly lfProjectsTotal = signal(0);
  private lfSearch = '';

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
  protected readonly ciiChecking = MENTORSHIP_CII_CHECKING;
  protected readonly nameChecking = MENTORSHIP_ENROLL_NAME_CHECKING;
  protected readonly nameTaken = MENTORSHIP_ENROLL_NAME_TAKEN;
  protected readonly codeOfConductTemplateUrl = MENTORSHIP_CODE_OF_CONDUCT_TEMPLATE_URL;

  protected readonly draftTechnology = toSignal(this.draftTechForm.controls.technology.valueChanges, { initialValue: '' });

  private readonly formSnapshot = toSignal(toObservable(this.form).pipe(switchMap((group) => group.valueChanges.pipe(startWith(group.getRawValue())))), {
    initialValue: {} as Record<string, unknown>,
  });

  protected readonly nameLength = computed(() => String(this.formSnapshot()['name'] ?? this.form().controls['name']?.value ?? '').length);
  protected readonly descriptionLength = computed(() =>
    mentorshipDescriptionLength(String(this.formSnapshot()['description'] ?? this.form().controls['description']?.value ?? ''))
  );
  protected readonly technologies = computed(() => {
    const fromSnapshot = this.formSnapshot()['technologies'];
    if (Array.isArray(fromSnapshot)) return fromSnapshot as string[];
    return (this.form().controls['technologies']?.value as string[]) ?? [];
  });
  protected readonly logoFileName = computed(() => String(this.formSnapshot()['logoFileName'] ?? this.form().controls['logoFileName']?.value ?? ''));
  protected readonly logoPreviewUrl = computed(() => String(this.formSnapshot()['logoPreviewUrl'] ?? this.form().controls['logoPreviewUrl']?.value ?? ''));
  protected readonly projectOptions = computed(() => {
    const selectedId = String(this.formSnapshot()['projectId'] ?? this.form().controls['projectId']?.value ?? '');
    const loaded = this.lfProjects();
    const options = loaded.map((project) => ({ ...project, value: project.id, label: project.name }));
    if (selectedId && !options.some((option) => option.value === selectedId)) {
      options.unshift({ id: selectedId, name: selectedId, value: selectedId, label: selectedId });
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
    toObservable(this.ciiProjectId).pipe(
      switchMap((projectId) => {
        if (!projectId) return of({ status: 'idle' as const, projectId: '' });
        if (!isMentorshipCiiProjectId(projectId)) return of({ status: 'invalid' as const, projectId });
        return timer(300).pipe(
          switchMap(() => this.mentorshipService.getCiiBadge(projectId)),
          map((badge) => (badge ? { status: 'valid' as const, projectId: badge.projectId } : { status: 'invalid' as const, projectId })),
          startWith({ status: 'loading' as const, projectId })
        );
      })
    ),
    { initialValue: { status: 'idle' as MentorshipCiiLookupStatus, projectId: '' } }
  );

  protected readonly nameLookup = toSignal(
    toObservable(this.programName).pipe(
      switchMap((name) => {
        if (name.length < MENTORSHIP_ENROLL_NAME_MIN) return of({ status: 'idle' as const });
        return timer(300).pipe(
          switchMap(() => this.mentorshipService.isProgramNameAvailable(name)),
          map((result) => ({ status: result.available ? ('available' as const) : ('taken' as const) })),
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

    this.mentorshipService
      .getPrograms()
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

    const firstPage$ = search$.pipe(
      tap((search) => {
        this.lfSearch = search;
        this.lfProjectsLoading.set(true);
      }),
      switchMap((search) =>
        this.mentorshipService.getLfProjects({ search, offset: 0, limit: MENTORSHIP_LF_PROJECT_PAGE_SIZE }).pipe(
          map((response) => ({ ...response, append: false as const })),
          catchError(() => {
            this.lfProjectsLoading.set(false);
            return EMPTY;
          })
        )
      )
    );

    const nextPage$ = this.lfLoadMore$.pipe(
      exhaustMap(() => {
        if (this.lfProjectsLoading() || this.lfProjects().length >= this.lfProjectsTotal()) return EMPTY;
        this.lfProjectsLoading.set(true);
        return this.mentorshipService.getLfProjects({ search: this.lfSearch, offset: this.lfProjects().length, limit: MENTORSHIP_LF_PROJECT_PAGE_SIZE }).pipe(
          takeUntil(search$),
          map((response) => ({ ...response, append: true as const })),
          catchError(() => {
            this.lfProjectsLoading.set(false);
            return EMPTY;
          })
        );
      })
    );

    merge(firstPage$, nextPage$)
      .pipe(takeUntilDestroyed())
      .subscribe((page) => {
        this.lfProjects.set(page.append ? [...this.lfProjects(), ...page.data] : page.data);
        this.lfProjectsTotal.set(page.total);
        this.lfProjectsLoading.set(false);
      });
  }

  protected onImportProgram(): void {
    const importId = (this.form().controls['importProgramId']?.value as string) ?? '';
    this.revokeLogoPreview();
    const fileEl = this.fileInput()?.nativeElement;
    if (fileEl) fileEl.value = '';
    this.form().patchValue(formFromImportedMentorshipProgram(importId));
    this.logoError.set('');
  }

  protected onLfFilter(event: { filter?: string }): void {
    this.lfFilter$.next((event.filter ?? '').trim());
  }

  protected onLfLazyLoad(event?: { last?: number }): void {
    if (this.lfProjectsLoading() || this.lfProjects().length >= this.lfProjectsTotal()) return;
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
      this.revokeLogoPreview();
      this.form().patchValue({ logoFileName: '', logoPreviewUrl: '' });
      return;
    }
    if (!isMentorshipLogoFileName(file.name)) {
      this.logoError.set(MENTORSHIP_ENROLL_LOGO_TYPE_ERROR);
      input.value = '';
      this.revokeLogoPreview();
      this.form().patchValue({ logoFileName: '', logoPreviewUrl: '' });
      return;
    }
    if (file.size > MENTORSHIP_ENROLL_LOGO_MAX_BYTES) {
      this.logoError.set('File must be 2 MB or smaller.');
      input.value = '';
      this.revokeLogoPreview();
      this.form().patchValue({ logoFileName: '', logoPreviewUrl: '' });
      return;
    }
    this.revokeLogoPreview();
    this.form().patchValue({
      logoFileName: file.name,
      logoPreviewUrl: URL.createObjectURL(file),
    });
  }

  protected projectInitial(name: string): string {
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  private revokeLogoPreview(): void {
    const url = this.form().controls['logoPreviewUrl']?.value as string;
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}
