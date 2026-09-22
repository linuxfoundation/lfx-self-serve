// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, model, PLATFORM_ID, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EDIT_LABEL,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_INTRO,
  MENTORSHIP_MENTEE_PROFILE_CANCEL_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeDemographics } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';
import { filter } from 'rxjs';

import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { MenteeDemographicsSectionComponent } from '../../../mentee-register/components/mentee-demographics-section/mentee-demographics-section.component';

const TITLE_ID = 'mentorship-mentee-demographics-edit-drawer-title';

/**
 * Edit drawer for the apply-page demographics summary. Reuses the register
 * form's demographics section. Save is a coming-soon toast until the profile
 * update endpoint exists — nothing typed here is written back to the summary.
 */
@Component({
  selector: 'lfx-mentorship-mentee-demographics-edit-drawer',
  imports: [DrawerModule, ButtonComponent, MenteeDemographicsSectionComponent],
  templateUrl: './mentee-demographics-edit-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeDemographicsEditDrawerComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly titleRef = viewChild<ElementRef<HTMLHeadingElement>>('titleRef');

  protected readonly title = MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EDIT_LABEL;
  protected readonly intro = MENTORSHIP_MENTEE_DEMOGRAPHICS_INTRO;
  protected readonly saveLabel = MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL;
  protected readonly cancelLabel = MENTORSHIP_MENTEE_PROFILE_CANCEL_LABEL;

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

  protected readonly drawerPt = computed(() => ({
    root: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': TITLE_ID },
  }));

  private previouslyFocusedElement: HTMLElement | null = null;

  constructor() {
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
    const answers = demographics ?? {};
    for (const row of MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS) {
      const raw = answers[row.answerControl as keyof MentorshipMenteeDemographics];
      const token = typeof raw === 'string' ? raw.trim() : '';
      const provided = token.length > 0 && token !== MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY;
      this.form.get(row.consentControl)?.setValue(provided);
      this.form.get(row.answerControl)?.setValue(provided ? token : '');
    }
  }

  protected onSave(): void {
    this.comingSoon.notify(this.title);
    this.visible.set(false);
  }

  protected onCancel(): void {
    this.visible.set(false);
  }

  protected onVisibleChange(visible: boolean): void {
    this.visible.set(visible);
  }

  protected onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.previouslyFocusedElement = document.activeElement as HTMLElement | null;
    this.titleRef()?.nativeElement.focus();
  }

  private restoreFocus(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.previouslyFocusedElement?.focus();
    this.previouslyFocusedElement = null;
  }
}
