// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import {
  MENTORSHIP_MENTOR_INTRODUCTION_INTRO,
  MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER,
  MENTORSHIP_MENTOR_PROFILE_CANCEL_LABEL,
  MENTORSHIP_MENTOR_PROFILE_EDIT_DRAWER_TITLE,
  MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTOR_PROFILE_SAVE_LABEL,
  MENTORSHIP_MENTOR_RESUME_INTRO,
  MENTORSHIP_MENTOR_SKILLS_INTRO,
} from '@lfx-one/shared/constants';
import { MentorshipMentorProgramRequest, MentorshipProgram } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { DrawerModule } from 'primeng/drawer';
import { filter, map, switchMap } from 'rxjs';

import { ResumeSectionComponent } from '../../../../components/resume-section/resume-section.component';
import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { MentorProgramsSectionComponent } from '../../../mentor-register/components/mentor-programs-section/mentor-programs-section.component';
import { MentorProfileEditDrawerService } from './mentor-profile-edit-drawer.service';

/**
 * Right-side mentor profile edit drawer, opened from the "Edit Mentor Profile" button
 * on the standalone mentor profile page. Mirrors the Become a Mentor registration form
 * sections — program details, introduction, skills, and resume — in a drawer layout.
 *
 * Save fires the coming-soon toast until the update endpoint is wired; the drawer does
 * not persist anything.
 */
@Component({
  selector: 'lfx-mentorship-mentor-profile-edit-drawer',
  imports: [DrawerModule, ButtonComponent, RichEditorComponent, MentorProgramsSectionComponent, SkillsPickerComponent, ResumeSectionComponent],
  templateUrl: './mentor-profile-edit-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProfileEditDrawerComponent {
  private readonly mentorshipService = inject(MentorshipService);
  private readonly comingSoon = inject(MentorshipComingSoonService);
  protected readonly drawer = inject(MentorProfileEditDrawerService);

  protected readonly title = MENTORSHIP_MENTOR_PROFILE_EDIT_DRAWER_TITLE;
  protected readonly saveLabel = MENTORSHIP_MENTOR_PROFILE_SAVE_LABEL;
  protected readonly cancelLabel = MENTORSHIP_MENTOR_PROFILE_CANCEL_LABEL;
  protected readonly introductionIntro = MENTORSHIP_MENTOR_INTRODUCTION_INTRO;
  protected readonly introductionPlaceholder = MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER;
  protected readonly skillsIntro = MENTORSHIP_MENTOR_SKILLS_INTRO;
  protected readonly resumeIntro = MENTORSHIP_MENTOR_RESUME_INTRO;

  protected readonly form = new FormGroup({
    introduction: new FormControl('', { nonNullable: true }),
    skills: new FormControl<string[]>([], { nonNullable: true }),
    resumeFileName: new FormControl('', { nonNullable: true }),
  });

  /**
   * Local program requests — starts empty on each drawer open. The mentor's current
   * enrollments are not available in {@link MentorshipMentorProfileDetails}, and save
   * is coming-soon anyway, so the picker behaves identically to the registration form.
   */
  protected readonly requests = signal<MentorshipMentorProgramRequest[]>([]);

  private readonly programsState = this.initPrograms();
  protected readonly programs = computed(() => this.programsState().programs);
  protected readonly programsLoading = computed(() => this.programsState().loading);

  public constructor() {
    toObservable(this.drawer.context)
      .pipe(filter(Boolean))
      .subscribe((profile) => this.seedForm(profile));
  }

  protected onAddProgram(program: MentorshipProgram): void {
    if (this.requests().some((request) => request.programId === program.id)) return;
    this.requests.update((requests) => [...requests, { id: `req_${program.id}`, programId: program.id, programName: program.name, status: 'pending' }]);
  }

  protected onWithdraw(requestId: string): void {
    this.requests.update((requests) => requests.filter((request) => request.id !== requestId));
  }

  protected onSave(): void {
    this.comingSoon.notify(MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL);
    this.drawer.close();
  }

  protected onCancel(): void {
    this.drawer.close();
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.drawer.close();
    }
  }

  /**
   * Load available programs when the drawer opens. switchMap cancels a prior open's
   * in-flight request so a slow earlier load can't overwrite a later one.
   */
  private initPrograms() {
    return toSignal(
      toObservable(this.drawer.context).pipe(
        filter(Boolean),
        switchMap(() => this.mentorshipService.getPrograms({ status: 'open' }).pipe(map((response) => ({ programs: response.data, loading: false }))))
      ),
      { initialValue: { programs: [] as MentorshipProgram[], loading: true } }
    );
  }

  private seedForm(profile: { aboutMe: string; skills: string[]; resumeFileName?: string }): void {
    this.form.patchValue({
      introduction: profile.aboutMe ?? '',
      skills: profile.skills ?? [],
      resumeFileName: profile.resumeFileName ?? '',
    });
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.requests.set([]);
  }
}
