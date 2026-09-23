// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { SelectComponent } from '@components/select/select.component';
import {
  MENTORSHIP_MENTEE_DEMOGRAPHIC_CONSENT_LABEL,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_INTRO,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_EMAIL,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_NOTE_PREFIX,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_TITLE,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeDemographicRow } from '@lfx-one/shared/interfaces';

/**
 * Demographic questions on the Become a Mentee form — age, racial/ethnic identity,
 * gender, socioeconomic class, and education level. Every question is optional, but
 * each answer dropdown stays disabled until its own consent checkbox is checked, and
 * unchecking consent again clears whatever answer was selected for that question.
 *
 * The disabled state is driven from the underlying `FormControl` via `disable()` /
 * `enable()`, so PrimeNG picks it up automatically through `ReactiveFormsModule` and
 * the template never binds a `[disabled]` attribute.
 *
 * Renders off `MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS` rather than five hand-written blocks,
 * so a new question is a data change here, not a template change.
 */
@Component({
  selector: 'lfx-mentorship-mentee-demographics-section',
  imports: [CheckboxComponent, SelectComponent],
  templateUrl: './mentee-demographics-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeDemographicsSectionComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  public readonly form = input.required<FormGroup>();
  public readonly isDrawer = input(false);

  protected readonly title = MENTORSHIP_MENTEE_DEMOGRAPHICS_TITLE;
  protected readonly intro = MENTORSHIP_MENTEE_DEMOGRAPHICS_INTRO;
  protected readonly consentLabel = MENTORSHIP_MENTEE_DEMOGRAPHIC_CONSENT_LABEL;
  protected readonly removalNotePrefix = MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_NOTE_PREFIX;
  protected readonly removalEmail = MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_EMAIL;

  /**
   * The removal-request `mailto:` link, marked as trusted so a future stricter sanitizer
   * config or a `TrustedTypes` policy cannot silently reduce it to `unsafe:...`. The URL
   * is constructed from a compile-time constant, never from user input, so the bypass is
   * safe — see `docs/reviews/knowledge-base/security.md` § `security/non-http-scheme-stripped`.
   */
  protected readonly removalMailto: SafeUrl = this.sanitizer.bypassSecurityTrustUrl(`mailto:${MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_EMAIL}`);

  /**
   * The demographic rows with their derived DOM ids precomputed once, populated in
   * `ngOnInit` — `input.required` values are unavailable at field-initializer time,
   * and reading them there throws `NG0950`.
   */
  protected readonly rows = signal<
    (MentorshipMenteeDemographicRow & { containerId: string; questionId: string; consentInputId: string; answerTestId: string })[]
  >([]);

  public ngOnInit(): void {
    this.rows.set(this.initRows());
  }

  /**
   * Builds each row view model and, per row, wires the answer control's disabled state
   * to its consent checkbox. Also clears the answer when consent is withdrawn so a
   * previously-selected value cannot leak back into the form once the mentee changes
   * their mind. `emitEvent: false` on both the clear and the enable/disable keeps the
   * parent form's snapshot signal from re-running the form validator on every keystroke.
   */
  private initRows() {
    const form = this.form();
    return MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS.map((row) => {
      const baseId = `mentorship-mentee-demographic-${row.answerControl}`;
      const consentControl = form.get(row.consentControl);
      const answerControl = form.get(row.answerControl);

      // Sync disabled state to the current consent value on every mount, not just
      // disable when unanswered — the drawer's `@if` remounts this component against
      // a long-lived `FormGroup`, so a control left disabled by an earlier uncheck-in-
      // this-session must be explicitly re-enabled here rather than assumed enabled.
      if (consentControl?.value) {
        answerControl?.enable({ emitEvent: false });
      } else {
        answerControl?.disable({ emitEvent: false });
      }

      consentControl?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((checked) => {
        if (checked) {
          answerControl?.enable({ emitEvent: false });
          return;
        }
        answerControl?.setValue('', { emitEvent: false });
        answerControl?.disable({ emitEvent: false });
      });

      return {
        ...row,
        containerId: baseId,
        questionId: `${baseId}-question`,
        consentInputId: `${baseId}-consent`,
        answerTestId: `${baseId}-answer`,
      };
    });
  }
}
