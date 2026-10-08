// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_ENROLL_LOGO_ACCEPT,
  MENTORSHIP_ENROLL_LOGO_FAILURE_FIELD_ERRORS,
  MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_PROGRAM_AVATAR_PALETTE,
  MENTORSHIP_PROGRAM_CARD_ADD_LOGO,
  MENTORSHIP_PROGRAM_CARD_LOGO_ADDED,
  MENTORSHIP_PROGRAM_CARD_LOGO_FORBIDDEN,
  MENTORSHIP_PROGRAM_CARD_LOGO_MISSING,
  MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES,
  MENTORSHIP_PROGRAM_STATUS_LABELS,
} from '@lfx-one/shared/constants';
import { MentorshipProgram } from '@lfx-one/shared/interfaces';
import { getMentorshipEnrollLogoError, stableKeyIndex } from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { finalize, take } from 'rxjs';

/**
 * Compact card for the mentorship admin list. Mirrors `InitiativeCardComponent`
 * shape: avatar tile on the left, project-line + status badge + title in the
 * middle, three-column metrics on the right, plus a chevron. Click emits the
 * program id so the parent can drive navigation. A program awaiting review or
 * published without a logo shows a "Logo missing" hint with an "Add logo" action
 * that uploads the logo and emits `changed` so the list reloads.
 */
@Component({
  selector: 'lfx-mentorship-program-card',
  imports: [AvatarComponent, ButtonComponent],
  templateUrl: './program-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramCardComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // ─── Inputs / Outputs ──────────────────────────────────────────────────────
  public readonly program = input.required<MentorshipProgram>();
  public readonly cardClick = output<string>();
  /** Emits after the program's logo was added, so the parent reloads the list. */
  public readonly changed = output<void>();

  // ─── Static Values ─────────────────────────────────────────────────────────
  protected readonly logoMissingLabel = MENTORSHIP_PROGRAM_CARD_LOGO_MISSING;
  protected readonly addLogoLabel = MENTORSHIP_PROGRAM_CARD_ADD_LOGO;
  protected readonly logoAccept = MENTORSHIP_ENROLL_LOGO_ACCEPT;

  // ─── Simple WritableSignals ────────────────────────────────────────────────
  protected readonly busy = signal(false);
  /** Set when the card is destroyed, so an upload that lands afterwards does not emit to a list that no longer holds it. */
  private destroyed = false;

  // ─── Computed ──────────────────────────────────────────────────────────────
  protected readonly seasonLine = computed(() => this.program().projectName);

  protected readonly statusLabel = computed(() => MENTORSHIP_PROGRAM_STATUS_LABELS[this.program().status]);
  protected readonly statusBadgeClass = computed(() => MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES[this.program().status]);

  /** Deterministic avatar tint based on the whole program title so repeat renders don't shuffle colors. */
  protected readonly avatarStyleClass = computed(
    () => MENTORSHIP_PROGRAM_AVATAR_PALETTE[stableKeyIndex(this.program().name, MENTORSHIP_PROGRAM_AVATAR_PALETTE.length)]
  );

  /** First letter of the title. `AvatarComponent.displayLabel` only renders `label.charAt(0)`. */
  protected readonly initials = computed(() => {
    const name = this.program().name.trim();
    return name.length > 0 ? name[0].toUpperCase() : '?';
  });

  public constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
  }

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onCardClick(): void {
    this.cardClick.emit(this.program().id);
  }

  /** Opens the file picker. The hint row sits beside the card's clickable row, so this never opens the program. */
  protected onAddLogo(fileInput: HTMLInputElement): void {
    if (this.busy()) return;
    fileInput.click();
  }

  /**
   * Uploads the picked logo. The program was created earlier, so a 403 is a real refusal and is not retried. The upload is
   * never cancelled by the card going away (a search, filter, reload or navigation), so it still finishes and toasts.
   */
  protected onLogoPicked(event: Event): void {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;

    const fileError = getMentorshipEnrollLogoError(file);
    if (fileError) {
      this.showToast('error', 'Error', fileError);
      return;
    }

    this.busy.set(true);
    this.mentorshipAdminService
      .uploadProgramLogo(this.program().id, file, false)
      .pipe(
        take(1),
        finalize(() => this.busy.set(false))
      )
      .subscribe({
        next: () => {
          this.showToast('success', 'Success', MENTORSHIP_PROGRAM_CARD_LOGO_ADDED);
          if (!this.destroyed) this.changed.emit();
        },
        error: (error: unknown) => this.showToast('error', 'Error', this.logoErrorMessage(error)),
      });
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────
  /** An impersonation 403 shows the server's text; any other 403 means the viewer may not change this program. */
  private logoErrorMessage(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED;
    if (error.status === 403) {
      if (error.error?.code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
        return serverAuthoredMessage(error, MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED);
      }
      return MENTORSHIP_PROGRAM_CARD_LOGO_FORBIDDEN;
    }
    return MENTORSHIP_ENROLL_LOGO_FAILURE_FIELD_ERRORS[error.status] ?? MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED;
  }

  private showToast(severity: 'success' | 'error', summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: 4000 });
  }
}
