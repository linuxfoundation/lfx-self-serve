// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import {
  MENTORSHIP_MENTOR_INTRODUCTION_INTRO,
  MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER,
  MENTORSHIP_MENTOR_PROFILE_CANCEL_LABEL,
  MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTOR_PROFILE_SAVE_LABEL,
  MENTORSHIP_MENTOR_SKILLS_INTRO,
} from '@lfx-one/shared/constants';
import {
  MentorshipMentorOpenProgram,
  MentorshipMentorProfileDetails,
  MentorshipMentorProfileFieldErrors,
  MentorshipMentorProfileUpdateRequest,
  MentorshipMentorProfileUpdateResponse,
  MentorshipMentorRequestsState,
} from '@lfx-one/shared/interfaces';
import { buildMentorshipMentorProfileUpdate, getMentorshipMentorProfileErrors, isMentorshipMentorProfileUpdateEmpty } from '@lfx-one/shared/utils';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DrawerModule } from 'primeng/drawer';
import { catchError, filter, finalize, map, of, startWith, switchMap } from 'rxjs';

import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { MentorProgramRequestService } from '../../../../services/mentor-program-request.service';
import { MentorProfileSaveService } from '../../../../services/mentor-profile-save.service';
import { MentorRequestWithdrawService } from '../../../../services/mentor-request-withdraw.service';
import { MentorProgramsSectionComponent } from '../../../mentor-register/components/mentor-programs-section/mentor-programs-section.component';
import { MentorProfileEditDrawerService } from './mentor-profile-edit-drawer.service';

/**
 * Right-side mentor profile edit drawer, opened from the "Edit Mentor Profile" button
 * on the standalone mentor profile page. Mirrors the Become a Mentor registration form
 * sections — program details, introduction, and skills — in a drawer layout.
 *
 * The programs section reads the programs itself, a page at a time. It mounts on the first open, so a
 * profile visit that never opens the drawer reads no programs, and stays mounted after a close, so
 * reopening lists what it already read and the content does not vanish while the drawer slides out.
 * Program requests are live: picking a program sends the request at once, and Withdraw (shown only
 * on pending rows) confirms and withdraws at once. Both leave the toasts to their services and the
 * refresh to `MentorshipMentorService`, whose revision signal makes the list re-read after a write.
 *
 * Save sends only the introduction and skills the mentor changed (see `buildMentorshipMentorProfileUpdate`),
 * checked by the rules register uses, and emits `saved` with the response so the host can show it in place.
 * On a failure the drawer stays open with the mentor's input and shows the message inline.
 */
@Component({
  selector: 'lfx-mentorship-mentor-profile-edit-drawer',
  imports: [ConfirmDialogModule, DrawerModule, ButtonComponent, RichEditorComponent, MentorProgramsSectionComponent, SkillsPickerComponent],
  providers: [ConfirmationService, MentorRequestWithdrawService],
  templateUrl: './mentor-profile-edit-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProfileEditDrawerComponent {
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly programRequests = inject(MentorProgramRequestService);
  private readonly withdrawService = inject(MentorRequestWithdrawService);
  private readonly saveService = inject(MentorProfileSaveService);
  private readonly injector = inject(Injector);
  private readonly errorRef = viewChild<ElementRef<HTMLElement>>('errorRef');
  protected readonly drawer = inject(MentorProfileEditDrawerService);
  protected readonly saving = this.saveService.saving;

  /** Emits the saved profile once the update succeeds, just before the drawer closes. */
  public readonly saved = output<MentorshipMentorProfileUpdateResponse>();

  protected readonly title = MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL;
  protected readonly saveLabel = MENTORSHIP_MENTOR_PROFILE_SAVE_LABEL;
  protected readonly cancelLabel = MENTORSHIP_MENTOR_PROFILE_CANCEL_LABEL;
  protected readonly introductionIntro = MENTORSHIP_MENTOR_INTRODUCTION_INTRO;
  protected readonly introductionPlaceholder = MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER;
  protected readonly skillsIntro = MENTORSHIP_MENTOR_SKILLS_INTRO;

  protected readonly form = new FormGroup({
    introduction: new FormControl('', { nonNullable: true }),
    skills: new FormControl<string[]>([], { nonNullable: true }),
  });

  /** False until the drawer first opens; the programs section mounts then. */
  protected readonly opened = signal(false);

  /** The message for the last failed Save, shown inline. Cleared on the next Save, on any edit and on re-seed. */
  protected readonly errorMessage = signal('');
  /** The profile the form was seeded from; Save sends only what differs from it. */
  private readonly seedProfile = signal<MentorshipMentorProfileDetails | null>(null);
  /** Field errors stay hidden until a Save finds one, then follow the mentor's edits. */
  private readonly showErrors = signal(false);
  private readonly formValue = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), { initialValue: this.form.getRawValue() });
  protected readonly errors = computed<MentorshipMentorProfileFieldErrors>(() => {
    this.formValue();
    const request = this.showErrors() ? this.buildRequest() : null;
    return request ? getMentorshipMentorProfileErrors(request) : {};
  });

  /** True while a picked program's request is in flight; the picker is disabled meanwhile. */
  protected readonly requesting = signal(false);
  protected readonly withdrawingId = this.withdrawService.withdrawingId;

  private readonly requestsState = this.initRequests();
  protected readonly requests = computed(() => this.requestsState().requests);
  protected readonly invitedProgramIds = computed(() => this.requestsState().invitedProgramIds);
  protected readonly requestsFailed = computed(() => this.requestsState().failed);
  protected readonly requestsLoading = computed(() => this.requestsState().loading);

  public constructor() {
    toObservable(this.drawer.context)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe((profile) => {
        this.opened.set(true);
        this.seedForm(profile);
      });

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.errorMessage.set(''));
  }

  protected onAddProgram(program: MentorshipMentorOpenProgram): void {
    if (this.requesting()) return;
    this.requesting.set(true);
    // Not tied to the drawer's lifetime: the request and its toast finish even if the drawer closes first.
    this.programRequests
      .request(program)
      .pipe(finalize(() => this.requesting.set(false)))
      .subscribe();
  }

  protected onWithdraw(requestId: string): void {
    this.withdrawService.confirmWithdraw(requestId);
  }

  /** Dropping the cache bumps the revision, so the request list reads again. */
  protected onRetryRequests(): void {
    this.mentorService.clearMentorCaches();
  }

  protected onSave(): void {
    if (this.saving()) {
      return;
    }

    this.errorMessage.set('');
    const request = this.buildRequest();
    if (!request) {
      return;
    }
    if (isMentorshipMentorProfileUpdateEmpty(request)) {
      this.drawer.close();
      return;
    }
    if (Object.keys(getMentorshipMentorProfileErrors(request)).length) {
      this.showErrors.set(true);
      return;
    }

    this.saveService.save(request).subscribe({
      next: (response) => {
        this.saved.emit(response);
        this.drawer.close();
      },
      error: (err: unknown) => this.showError(this.saveService.errorMessage(err)),
    });
  }

  protected onCancel(): void {
    if (this.saving()) {
      return;
    }
    this.drawer.close();
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible && !this.saving()) {
      this.drawer.close();
    }
  }

  /**
   * Load the mentor's requests when the drawer opens, and again whenever a request or withdraw
   * bumps `mentorRequestsRevision`. Only an open shows the loading state, so a refresh after a
   * write keeps the current rows until the new ones arrive. A failed read (already logged by the
   * service) is recorded as failed rather than as an empty list, so the section shows a Retry and keeps
   * the picker disabled instead of offering programs that are already requested.
   */
  private initRequests() {
    const empty: MentorshipMentorRequestsState = { requests: [], invitedProgramIds: [], loading: true, failed: false };
    const failed: MentorshipMentorRequestsState = { requests: [], invitedProgramIds: [], loading: false, failed: true };
    const revision$ = toObservable(this.mentorService.mentorRequestsRevision);

    return toSignal(
      toObservable(this.drawer.context).pipe(
        filter(Boolean),
        switchMap(() =>
          revision$.pipe(
            switchMap(() =>
              this.mentorService.getMentorRequests().pipe(
                map(
                  (response): MentorshipMentorRequestsState => ({
                    requests: response.data,
                    invitedProgramIds: response.invitedProgramIds,
                    loading: false,
                    failed: false,
                  })
                ),
                catchError(() => of(failed))
              )
            ),
            startWith(empty)
          )
        )
      ),
      { initialValue: empty }
    );
  }

  /** The changed fields as they stand, or null before the drawer has a profile to compare with. */
  private buildRequest(): MentorshipMentorProfileUpdateRequest | null {
    const seed = this.seedProfile();
    if (!seed) return null;
    const { introduction, skills } = this.form.getRawValue();
    return buildMentorshipMentorProfileUpdate(seed, { introduction, skills });
  }

  /**
   * Shows the message and moves focus to it once rendered: the disabled Save button drops focus while
   * saving, and the alert can sit below the fold of a long form. `afterNextRender` never runs on the server.
   */
  private showError(message: string): void {
    this.errorMessage.set(message);
    afterNextRender(() => this.errorRef()?.nativeElement.focus(), { injector: this.injector });
  }

  private seedForm(profile: MentorshipMentorProfileDetails): void {
    this.seedProfile.set(profile);
    this.showErrors.set(false);
    this.form.patchValue({
      introduction: profile.aboutMe ?? '',
      skills: profile.skills ?? [],
    });
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.errorMessage.set('');
  }
}
