// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, ElementRef, input, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_MENTOR_RESUME_ACCEPT,
  MENTORSHIP_MENTOR_RESUME_EMPTY_LABEL,
  MENTORSHIP_MENTOR_RESUME_HELPER,
  MENTORSHIP_MENTOR_RESUME_MAX_BYTES,
  MENTORSHIP_MENTOR_RESUME_SIZE_ERROR,
  MENTORSHIP_MENTOR_RESUME_TYPE_ERROR,
} from '@lfx-one/shared/constants';
import { isMentorshipResumeFileName } from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';
import { startWith, switchMap } from 'rxjs';

/**
 * Resume upload used by every mentorship register form. Extracted from the previously
 * duplicated `MentorResumeSectionComponent` / `MenteeResumeSectionComponent` — same reuse
 * pattern `SkillsPickerComponent` and `TermsAcknowledgementComponent` follow: callers
 * pass their own copy via `intro` and their own ID/testid namespace via `idPrefix`.
 *
 * The file *name* lands on the form; the bytes stay in the input element only, since no
 * upload endpoint exists yet. Type and size are rejected at selection rather than at
 * submit so the picker is still in front of the user when they find out — that is why
 * the resume has no entry in either form's `*RegisterFieldErrors` interface.
 *
 * The accept list, size cap and generic file-picker error text are file-picker plumbing,
 * not persona copy — they stay on the `MENTORSHIP_MENTOR_RESUME_*` constants both forms
 * already share, so a rename would churn beyond the review's ask.
 */
@Component({
  selector: 'lfx-mentorship-resume-section',
  imports: [ButtonComponent, TooltipModule],
  templateUrl: './resume-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResumeSectionComponent {
  public readonly form = input.required<FormGroup>();
  public readonly intro = input.required<string>();
  /** When false, the card wrapper (border + padding + rounded corners) is stripped — used inside drawers. */
  public readonly bordered = input(true);

  protected readonly wrapperClass = computed(() =>
    this.bordered() ? 'flex flex-col gap-6 rounded-2xl border border-gray-200 bg-white p-6 md:p-8' : 'flex flex-col gap-6'
  );
  /**
   * Namespace for every rendered `id` and `data-testid`. Mentor form passes
   * `'mentorship-mentor-resume'`, mentee form passes `'mentorship-mentee-resume'` — the
   * same two prefixes their former sibling components used, so consumers and specs
   * anchor to unchanged selectors after the merge.
   */
  public readonly idPrefix = input.required<string>();

  protected readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly accept = MENTORSHIP_MENTOR_RESUME_ACCEPT;
  protected readonly helper = MENTORSHIP_MENTOR_RESUME_HELPER;
  protected readonly emptyLabel = MENTORSHIP_MENTOR_RESUME_EMPTY_LABEL;

  protected readonly fileError = signal('');

  protected readonly resumeFileName = this.initResumeFileName();

  protected onBrowse(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.fileError.set('');

    if (!file) {
      this.setFileName('');
      return;
    }
    if (!isMentorshipResumeFileName(file.name)) {
      this.reject(input, MENTORSHIP_MENTOR_RESUME_TYPE_ERROR);
      return;
    }
    if (file.size > MENTORSHIP_MENTOR_RESUME_MAX_BYTES) {
      this.reject(input, MENTORSHIP_MENTOR_RESUME_SIZE_ERROR);
      return;
    }

    this.setFileName(file.name);
  }

  protected onClear(): void {
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
    this.fileError.set('');
    this.setFileName('');
  }

  private initResumeFileName() {
    // Read back through the form rather than a local copy, so a parent-side reset clears
    // the displayed name too.
    const snapshot = toSignal(toObservable(this.form).pipe(switchMap((group) => group.valueChanges.pipe(startWith(group.getRawValue())))), {
      initialValue: {} as Record<string, unknown>,
    });

    return computed(() => {
      const fromSnapshot = snapshot()['resumeFileName'];
      if (typeof fromSnapshot === 'string') return fromSnapshot;
      return (this.form().controls['resumeFileName']?.value as string) ?? '';
    });
  }

  private reject(input: HTMLInputElement, message: string): void {
    this.fileError.set(message);
    input.value = '';
    this.setFileName('');
  }

  private setFileName(fileName: string): void {
    this.form().controls['resumeFileName'].setValue(fileName);
  }
}
