// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  model,
  output,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EDIT_LABEL,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_EDIT_DRAWER_TITLE_ID,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_INTRO,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_PROFILE_CANCEL_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeDemographics, MentorshipMenteeProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import { buildMentorshipMenteeDemographicsUpdate, isMentorshipMenteeProfileUpdateEmpty } from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';
import { filter } from 'rxjs';

import { MenteeProfileSaveService } from '../../../../services/mentee-profile-save.service';
import { MenteeDemographicsSectionComponent } from '../../../mentee-register/components/mentee-demographics-section/mentee-demographics-section.component';

/**
 * Edit drawer for the apply-page demographics summary. Reuses the register
 * form's demographics section. Save sends only the demographics and socioeconomics groups
 * whose answers changed (see `buildMentorshipMenteeDemographicsUpdate`) and emits `saved` with
 * the response, so the apply page can refresh its summary in place. On a failure the drawer
 * stays open with the mentee's answers and shows the message inline.
 */
@Component({
  selector: 'lfx-mentorship-mentee-demographics-edit-drawer',
  imports: [DrawerModule, ButtonComponent, MenteeDemographicsSectionComponent],
  templateUrl: './mentee-demographics-edit-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeDemographicsEditDrawerComponent {
  private readonly saveService = inject(MenteeProfileSaveService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);
  private readonly titleRef = viewChild<ElementRef<HTMLHeadingElement>>('titleRef');
  private readonly errorRef = viewChild<ElementRef<HTMLElement>>('errorRef');

  /** Emits the saved profile once the update succeeds, just before the drawer closes. */
  public readonly saved = output<MentorshipMenteeProfileUpdateResponse>();

  protected readonly form = new FormGroup({
    ageConsent: new FormControl(false, { nonNullable: true }),
    age: new FormControl('', { nonNullable: true }),
    raceEthnicityConsent: new FormControl(false, { nonNullable: true }),
    raceEthnicity: new FormControl('', { nonNullable: true }),
    genderConsent: new FormControl(false, { nonNullable: true }),
    gender: new FormControl('', { nonNullable: true }),
    incomeConsent: new FormControl(false, { nonNullable: true }),
    income: new FormControl('', { nonNullable: true }),
    educationConsent: new FormControl(false, { nonNullable: true }),
    education: new FormControl('', { nonNullable: true }),
  });

  public readonly visible = model(false);

  protected readonly saving = this.saveService.saving;
  /** The message for the last failed Save, shown inline. Cleared on the next Save, on any edit and on re-seed. */
  protected readonly errorMessage = signal('');

  protected readonly title = MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EDIT_LABEL;
  protected readonly intro = MENTORSHIP_MENTEE_DEMOGRAPHICS_INTRO;
  protected readonly saveLabel = MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL;
  protected readonly cancelLabel = MENTORSHIP_MENTEE_PROFILE_CANCEL_LABEL;
  protected readonly titleId = MENTORSHIP_MENTEE_DEMOGRAPHICS_EDIT_DRAWER_TITLE_ID;

  protected readonly drawerPt = computed(() => ({
    root: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': this.titleId },
  }));

  private previouslyFocusedElement: HTMLElement | null = null;
  private seedDemographics: MentorshipMenteeDemographics | undefined;

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.errorMessage.set(''));

    toObservable(this.visible)
      .pipe(
        filter((visible) => !visible),
        takeUntilDestroyed()
      )
      .subscribe(() => this.restoreFocus());
  }

  /**
   * Called by the apply page before the drawer opens, so the demographics
   * section's `ngOnInit` sees consent already checked for saved answers and
   * leaves those dropdowns enabled.
   */
  public seed(demographics: MentorshipMenteeDemographics | undefined): void {
    this.seedDemographics = demographics;
    const answers = demographics ?? {};
    for (const row of MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS) {
      const raw = answers[row.answerControl as keyof MentorshipMenteeDemographics];
      const token = typeof raw === 'string' ? raw.trim() : '';
      const provided = token.length > 0 && token !== MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY;
      this.form.get(row.consentControl)?.setValue(provided);
      this.form.get(row.answerControl)?.setValue(provided ? token : '');
    }
    this.errorMessage.set('');
  }

  protected onSave(): void {
    if (this.saving()) {
      return;
    }

    this.errorMessage.set('');
    const request = buildMentorshipMenteeDemographicsUpdate(this.seedDemographics, this.form.getRawValue());
    if (isMentorshipMenteeProfileUpdateEmpty(request)) {
      this.visible.set(false);
      return;
    }

    this.saveService.save(request, MENTORSHIP_MENTEE_DEMOGRAPHICS_SAVE_SUCCESS_SUMMARY).subscribe({
      next: (response) => {
        this.saved.emit(response);
        this.visible.set(false);
      },
      error: (err: unknown) => this.showError(this.saveService.errorMessage(err)),
    });
  }

  protected onCancel(): void {
    if (this.saving()) {
      return;
    }
    this.visible.set(false);
  }

  protected onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.previouslyFocusedElement = document.activeElement as HTMLElement | null;
    this.titleRef()?.nativeElement.focus();
  }

  /**
   * Shows the message and moves focus to it once rendered: the disabled Save button drops focus while
   * saving, and the alert can sit below the fold of a long form. `afterNextRender` never runs on the server.
   */
  private showError(message: string): void {
    this.errorMessage.set(message);
    afterNextRender(() => this.errorRef()?.nativeElement.focus(), { injector: this.injector });
  }

  private restoreFocus(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.previouslyFocusedElement?.focus();
    this.previouslyFocusedElement = null;
  }
}
