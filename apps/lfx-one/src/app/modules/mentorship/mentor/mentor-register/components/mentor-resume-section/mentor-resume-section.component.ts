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
  MENTORSHIP_MENTOR_RESUME_INTRO,
} from '@lfx-one/shared/constants';
import { isMentorshipResumeFileName } from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';
import { startWith, switchMap } from 'rxjs';

/**
 * Resume upload for the Become a Mentor form. Like the enroll wizard's logo picker, this
 * stores the file *name* on the form and keeps the bytes in the input element only —
 * there is no upload endpoint yet, so nothing else would have anywhere to send them.
 *
 * Type and size are rejected at selection rather than at submit, so the mentor finds out
 * while the picker is still in front of them. That is why the resume has no entry in
 * `MentorshipMentorRegisterFieldErrors`.
 */
@Component({
  selector: 'lfx-mentorship-mentor-resume-section',
  imports: [ButtonComponent, TooltipModule],
  templateUrl: './mentor-resume-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorResumeSectionComponent {
  public readonly form = input.required<FormGroup>();

  protected readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly intro = MENTORSHIP_MENTOR_RESUME_INTRO;
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
