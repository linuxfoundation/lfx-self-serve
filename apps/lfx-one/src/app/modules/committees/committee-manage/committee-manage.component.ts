// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { COMMITTEE_FORM_STEPS, COMMITTEE_INVITE_CONCURRENCY, COMMITTEE_LABEL, COMMITTEE_STEP_TITLES, COMMITTEE_TOTAL_STEPS } from '@lfx-one/shared/constants';
import { Committee, MemberPendingChanges } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { StepperModule } from 'primeng/stepper';
import { BehaviorSubject, catchError, concat, EMPTY, filter, finalize, from, map, mergeMap, Observable, of, switchMap, take, toArray } from 'rxjs';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { evictOnWriteAccessLoss } from '@shared/utils/evict-on-write-access-loss.util';

import { CommitteeBasicInfoComponent } from '../components/committee-basic-info/committee-basic-info.component';
import { CommitteeCategorySelectionComponent } from '../components/committee-category-selection/committee-category-selection.component';
import { CommitteeMembersManagerComponent } from '../components/committee-members-manager/committee-members-manager.component';
import { CommitteeSettingsComponent } from '../components/committee-settings/committee-settings.component';

@Component({
  selector: 'lfx-committee-manage',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    StepperModule,
    ConfirmDialogModule,
    ButtonComponent,
    CommitteeCategorySelectionComponent,
    CommitteeBasicInfoComponent,
    CommitteeSettingsComponent,
    CommitteeMembersManagerComponent,
  ],
  templateUrl: './committee-manage.component.html',
  styleUrl: './committee-manage.component.scss',
})
export class CommitteeManageComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);
  // Mode and state signals
  public mode = signal<'create' | 'edit'>('create');
  public committeeId = signal<string | null>(null);
  public isEditMode = computed(() => this.mode() === 'edit');

  // Initialize committee data
  public committee = this.initializeCommittee();
  public project = computed(() => this.projectContextService.activeContext());

  // Member management state
  public memberUpdates = signal<MemberPendingChanges>({ toAdd: [], toUpdate: [], toDelete: [], toInvite: [] });
  public memberUpdatesRefresh$ = new BehaviorSubject<void>(undefined);

  // Stepper state
  private internalStep = signal<number>(1);
  public currentStep = toSignal(of(1), { initialValue: 1 });
  public readonly totalSteps = COMMITTEE_TOTAL_STEPS;
  public readonly stepTitles = COMMITTEE_STEP_TITLES;
  public readonly formSteps = COMMITTEE_FORM_STEPS;

  // Form state
  public readonly form: FormGroup = this.createCommitteeFormGroup();
  public submitting = signal<boolean>(false);

  // Validation signals for template
  private formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  public readonly canProceed = computed(() => {
    this.formValue();
    return this.isStepValid(this.currentStep());
  });
  // Live Step 3 draft, passed down so Step 4's invite dialog validates against what's about to be
  // saved rather than a possibly-stale persisted committee (LFXV2-2606 review).
  public readonly organizationRequirements = computed(() => ({
    enable_voting: !!this.formValue().enable_voting,
    business_email_required: !!this.formValue().business_email_required,
  }));
  public readonly canGoNext = computed(() => this.currentStep() + 1 < this.totalSteps && this.canNavigateToStep(this.currentStep() + 1));
  public readonly canGoPrevious = computed(() => this.currentStep() > 1);
  public readonly isFirstStep = computed(() => this.currentStep() === 1);
  public readonly isLastFormStep = computed(() => this.currentStep() === this.formSteps.SETTINGS);
  public readonly isLastStep = computed(() => this.currentStep() === this.totalSteps);
  public readonly currentStepTitle = computed(() => this.getStepTitle(this.currentStep()));
  public readonly hasMemberUpdates = computed(
    () =>
      this.memberUpdates().toAdd.length > 0 ||
      this.memberUpdates().toUpdate.length > 0 ||
      this.memberUpdates().toDelete.length > 0 ||
      this.memberUpdates().toInvite.length > 0
  );

  // UI labels
  public readonly committeeLabel = COMMITTEE_LABEL.singular;
  public readonly committeeLabelPlural = COMMITTEE_LABEL.plural;

  public constructor() {
    evictOnWriteAccessLoss();
    // Initialize step based on mode
    this.currentStep = toSignal(
      this.route.queryParamMap.pipe(
        switchMap((params) => {
          // In edit mode, use query parameters
          if (this.isEditMode()) {
            const stepParam = params.get('step');
            if (stepParam) {
              const step = parseInt(stepParam, 10);
              if (step >= 1 && step <= this.totalSteps) {
                return of(step);
              }
            }
            return of(1);
          }
          // In create mode, use internal step signal
          return toObservable(this.internalStep);
        })
      ),
      { initialValue: 1 }
    );

    // Populate form when editing
    toObservable(this.committee)
      .pipe(
        filter((committee): committee is Committee => committee !== null && this.isEditMode()),
        take(1)
      )
      .subscribe((committee) => {
        this.populateFormWithCommitteeData(committee);
      });
  }

  public goToStep(step: number | undefined): void {
    if (step !== undefined && this.canNavigateToStep(step)) {
      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step: step } });
      } else {
        this.internalStep.set(step);
      }
      this.scrollToStepper();
    }
  }

  public nextStep(): void {
    const next = this.currentStep() + 1;
    if (next <= this.totalSteps && this.canNavigateToStep(next)) {
      // Auto-generate group name when moving from step 1 (category) to step 2 (basic info)
      if (this.currentStep() === 1 && next === 2 && !this.isEditMode()) {
        this.generateGroupName();
      }

      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step: next } });
      } else {
        this.internalStep.set(next);
      }
      this.scrollToStepper();
    }
  }

  public previousStep(): void {
    const previous = this.currentStep() - 1;
    if (previous >= 1) {
      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step: previous } });
      } else {
        this.internalStep.set(previous);
      }
      this.scrollToStepper();
    }
  }

  public onCancel(): void {
    this.router.navigate(['/groups']);
  }

  public onSubmit(): void {
    // Mark all form controls as touched to show validation errors
    Object.keys(this.form.controls).forEach((key) => {
      const control = this.form.get(key);
      control?.markAsTouched();
      control?.markAsDirty();
    });

    if (this.form.invalid) {
      this.messageService.add({
        severity: 'error',
        summary: 'Validation Error',
        detail: 'Please fill in all required fields correctly',
      });
      return;
    }

    this.submitting.set(true);

    const formValue = {
      ...this.form.value,
      calendar: {
        public: this.form.value.public || false,
      },
      display_name: this.form.value.display_name || this.form.value.name,
      website: this.form.value.website || null,
      project_uid: this.committee()?.project_uid || this.project()?.uid || null,
    };

    const committeeData = this.cleanFormData(formValue);

    if (this.isEditMode() && this.committeeId()) {
      // Update existing committee
      this.committeeService.updateCommittee(this.committeeId()!, committeeData).subscribe({
        next: () => this.handleCommitteeSuccess('updated'),
        error: (err: HttpErrorResponse) => this.handleCommitteeError('update', err),
      });
    } else {
      // Create new committee
      this.committeeService.createCommittee(committeeData).subscribe({
        next: (committee) => this.handleCreateSuccess(committee),
        error: (err: HttpErrorResponse) => this.handleCommitteeError('create', err),
      });
    }
  }

  public onDone(): void {
    // Create mode - process member changes then navigate
    this.submitting.set(true);

    // Nothing staged — just navigate
    if (!this.hasMemberUpdates()) {
      this.submitting.set(false);
      this.router.navigate(['/groups']);
      return;
    }

    this.flushMemberUpdates()
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (results) => {
          this.showMemberOperationToast(results);
          this.router.navigate(['/groups']);
        },
        error: (err: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: getHttpErrorDetail(err, 'Failed to save member changes'),
          });
          this.router.navigate(['/groups']);
        },
      });
  }

  public onMemberUpdatesChange(updates: MemberPendingChanges): void {
    this.memberUpdates.set(updates);
  }

  public onSubmitAll(): void {
    // Edit mode only - save the committee, then flush member/invite changes once it lands
    if (!this.isEditMode()) {
      return;
    }

    // Mark all form controls as touched to show validation errors
    Object.keys(this.form.controls).forEach((key) => {
      const control = this.form.get(key);
      control?.markAsTouched();
      control?.markAsDirty();
    });

    if (this.form.invalid) {
      this.messageService.add({
        severity: 'error',
        summary: 'Validation Error',
        detail: 'Please fill in all required fields correctly',
      });
      return;
    }

    this.submitting.set(true);

    const formValue = {
      ...this.form.value,
      calendar: {
        public: this.form.value.public || false,
      },
      display_name: this.form.value.display_name || this.form.value.name,
      website: this.form.value.website || null,
      project_uid: this.committee()?.project_uid || this.project()?.uid || null,
    };

    const committeeData = this.cleanFormData(formValue);

    // Prepare committee update
    const updateCommittee$ = this.committeeService.updateCommittee(this.committeeId()!, committeeData);

    // Invite creation snapshots committee_name/organization_required server-side at POST time, so
    // the committee update must land before invites flush — otherwise a race can bake stale
    // committee metadata into an invite. Sequence rather than run them in parallel.
    updateCommittee$
      .pipe(
        switchMap((committee) => this.flushMemberUpdates().pipe(map((members) => ({ committee, members })))),
        finalize(() => this.submitting.set(false))
      )
      .subscribe({
        next: (result: { committee: Committee; members: { type: string; success: number; failed: number }[] }) => {
          const memberResults = result.members;

          // Show success message
          if (memberResults.length > 0) {
            this.showMemberOperationToast(memberResults);
          } else {
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: `${this.committeeLabel} updated successfully`,
            });
          }

          // Navigate back to committees list
          this.router.navigate(['/groups']);
        },
        error: (err: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: getHttpErrorDetail(err, `Failed to update ${this.committeeLabel.toLowerCase()}. Please try again.`),
          });
        },
      });
  }

  // Private methods
  private initializeCommittee() {
    return toSignal(
      this.route.paramMap.pipe(
        switchMap((params) => {
          const committeeId = params.get('id');
          if (committeeId) {
            this.mode.set('edit');
            this.committeeId.set(committeeId);
            return this.committeeService.getCommittee(committeeId);
          }

          this.mode.set('create');
          return of(null);
        })
      ),
      { initialValue: null }
    );
  }

  private populateFormWithCommitteeData(committee: Committee): void {
    this.form.patchValue({
      name: committee.name,
      category: committee.category,
      description: committee.description,
      parent_uid: committee.parent_uid,
      business_email_required: committee.business_email_required,
      enable_voting: committee.enable_voting,
      is_audit_enabled: committee.is_audit_enabled,
      public: committee.public,
      display_name: committee.display_name,
      sso_group_enabled: committee.sso_group_enabled,
      sso_group_name: committee.sso_group_name,
      website: committee.website,
      join_mode: committee.join_mode || 'invite_only',
      member_visibility: committee.member_visibility || 'hidden',
      show_meeting_attendees: committee.show_meeting_attendees || false,
    });
  }

  private createCommitteeFormGroup(): FormGroup {
    return new FormGroup({
      // Step 1: Category Selection
      category: new FormControl('', [Validators.required]),

      // Step 2: Basic Info
      name: new FormControl('', [Validators.required]),
      description: new FormControl(''),
      parent_uid: new FormControl(null),
      display_name: new FormControl(''),
      website: new FormControl('', [Validators.pattern(/^https?:\/\/.+\..+/)]),

      // Step 3: Settings
      business_email_required: new FormControl(false),
      enable_voting: new FormControl(false),
      is_audit_enabled: new FormControl(false),
      public: new FormControl(false),
      sso_group_enabled: new FormControl(false),
      sso_group_name: new FormControl(''),
      join_mode: new FormControl('invite_only'),
      member_visibility: new FormControl('hidden'),
      show_meeting_attendees: new FormControl(false),
    });
  }

  private cleanFormData(formData: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};

    Object.keys(formData).forEach((key) => {
      const value = formData[key];
      if (typeof value === 'string' && value.trim() === '') {
        cleaned[key] = null;
      } else {
        cleaned[key] = value;
      }
    });

    return cleaned;
  }

  private handleCreateSuccess(committee: Committee): void {
    this.submitting.set(false);
    this.committeeId.set(committee.uid);

    this.messageService.add({
      severity: 'success',
      summary: 'Success',
      detail: `${this.committeeLabel} created successfully`,
    });

    // Navigate to step 4 (Add Members)
    this.nextStep();
  }

  private handleCommitteeSuccess(action: 'created' | 'updated'): void {
    this.submitting.set(false);

    this.messageService.add({
      severity: 'success',
      summary: 'Success',
      detail: `${this.committeeLabel} ${action} successfully`,
    });

    if (this.isEditMode()) {
      // In edit mode, navigate to step 4 for members
      this.router.navigate([], { queryParams: { step: this.formSteps.ADD_MEMBERS } });
    } else {
      this.router.navigate(['/groups']);
    }
  }

  private handleCommitteeError(operation: 'create' | 'update', err: HttpErrorResponse): void {
    this.submitting.set(false);

    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: getHttpErrorDetail(err, `Failed to ${operation} ${this.committeeLabel.toLowerCase()}. Please try again.`),
    });
  }

  private canNavigateToStep(step: number): boolean {
    // Allow navigation to previous steps or current step
    if (step <= this.currentStep()) {
      return true;
    }

    // For forward navigation, validate all previous steps
    for (let i = 1; i < step; i++) {
      if (!this.isStepValid(i)) {
        return false;
      }
    }
    return true;
  }

  private isStepValid(step: number): boolean {
    switch (step) {
      case this.formSteps.CATEGORY:
        // Category must be selected
        return !!(this.form.get('category')?.value && this.form.get('category')?.valid);

      case this.formSteps.BASIC_INFO:
        // Name is required
        return !!(this.form.get('name')?.value && this.form.get('name')?.valid);

      case this.formSteps.SETTINGS:
        // Settings step is always valid (all toggles are optional)
        return true;

      case this.formSteps.ADD_MEMBERS:
        // Members step is optional
        return true;

      default:
        return false;
    }
  }

  private getStepTitle(step: number): string {
    const index = step - 1;
    if (index < 0 || index >= this.stepTitles.length) {
      return '';
    }
    return this.stepTitles[index];
  }

  private scrollToStepper(): void {
    const committeeManage = document.getElementById('committee-manage');
    if (committeeManage) {
      const elementTop = committeeManage.getBoundingClientRect().top + window.pageYOffset;
      window.scrollTo({
        top: elementTop - 100,
        behavior: 'smooth',
      });
    }
  }

  private generateGroupName(): void {
    const category = this.form.get('category')?.value;
    const currentName = this.form.get('name')?.value;

    // Only auto-generate if category is selected and name is empty
    if (category && (!currentName || currentName.trim() === '')) {
      this.form.get('name')?.setValue(category);
    }
  }

  private buildMemberOperations(committeeId: string, memberUpdates: MemberPendingChanges) {
    const operations: ReturnType<typeof this.createMemberOperation>[] = [];

    // Add delete operation if there are members to delete
    if (memberUpdates.toDelete.length > 0) {
      for (const memberId of memberUpdates.toDelete) {
        operations.push(this.createMemberOperation('delete', () => this.committeeService.deleteCommitteeMember(committeeId, memberId)));
      }
    }

    // Add update operation if there are members to update
    if (memberUpdates.toUpdate.length > 0) {
      for (const update of memberUpdates.toUpdate) {
        operations.push(this.createMemberOperation('update', () => this.committeeService.updateCommitteeMember(committeeId, update.uid, update.changes)));
      }
    }

    // Add create operation if there are members to add
    if (memberUpdates.toAdd.length > 0) {
      for (const member of memberUpdates.toAdd) {
        operations.push(this.createMemberOperation('add', () => this.committeeService.createCommitteeMember(committeeId, member)));
      }
    }

    return operations;
  }

  /**
   * Flush every staged member change. Deletes/updates/adds run sequentially (member mutations may
   * have ordering requirements), then staged bulk email invites — deferred until wizard completion
   * (LFXV2-2606) — run with the same bounded concurrency as the immediate-send invite path
   * (COMMITTEE_INVITE_CONCURRENCY), after the member mutations finish.
   */
  private flushMemberUpdates(): Observable<{ type: string; success: number; failed: number }[]> {
    const committeeId = this.committeeId()!;
    const memberUpdates = this.memberUpdates();

    const memberOperations = this.buildMemberOperations(committeeId, memberUpdates);
    const memberOps$ = memberOperations.length > 0 ? concat(...memberOperations) : EMPTY;

    const invites = memberUpdates.toInvite;
    const inviteOps$ =
      invites.length > 0
        ? from(invites).pipe(
            mergeMap(
              (invite) => this.createMemberOperation('invite', () => this.committeeService.createCommitteeInvite(committeeId, invite)),
              COMMITTEE_INVITE_CONCURRENCY
            )
          )
        : EMPTY;

    return concat(memberOps$, inviteOps$).pipe(toArray());
  }

  private createMemberOperation(type: string, operation: () => Observable<unknown>) {
    return operation().pipe(
      switchMap(() => of({ type, success: 1, failed: 0 })),
      catchError(() => of({ type, success: 0, failed: 1 }))
    );
  }

  private showMemberOperationToast(results: { type: string; success: number; failed: number }[]): void {
    const totalSuccess = results.reduce((sum, result) => sum + result.success, 0);
    const totalFailed = results.reduce((sum, result) => sum + result.failed, 0);
    const totalOperations = totalSuccess + totalFailed;
    const inviteOps = results.filter((result) => result.type === 'invite').length;
    const memberOps = results.length - inviteOps;
    // A batch that mixes member mutations with invites shouldn't be mislabeled as one or the
    // other — use neutral wording rather than reporting invites as "member(s) updated".
    const isMixed = memberOps > 0 && inviteOps > 0;
    const { noun, verb, failVerb } = this.describeOperationWording(memberOps, inviteOps);

    if (totalSuccess === totalOperations) {
      // All successful
      const detail =
        memberOps > 0 && !isMixed ? `${this.committeeLabel} and ${totalSuccess} ${noun} ${verb} successfully` : `${totalSuccess} ${noun} ${verb} successfully`;
      this.messageService.add({ severity: 'success', summary: 'Success', detail });
    } else if (totalSuccess > 0 && totalFailed > 0) {
      // Partial success
      this.messageService.add({
        severity: 'warn',
        summary: 'Partial Success',
        detail: `${totalSuccess} ${noun} ${verb} successfully, ${totalFailed} failed`,
      });
    } else if (totalFailed === totalOperations) {
      // All failed
      this.messageService.add({
        severity: 'error',
        summary: 'Operation Failed',
        detail: `Failed to ${failVerb} ${totalFailed} ${noun}`,
      });
    }
  }

  /** Wording varies by batch composition: pure member changes, pure invites, or a mix of both. */
  private describeOperationWording(memberOps: number, inviteOps: number): { noun: string; verb: string; failVerb: string } {
    if (memberOps > 0 && inviteOps > 0) {
      return { noun: 'update(s)', verb: 'processed', failVerb: 'process' };
    }
    if (inviteOps > 0) {
      return { noun: 'invitation(s)', verb: 'sent', failVerb: 'send' };
    }
    return { noun: 'member(s)', verb: 'updated', failVerb: 'update' };
  }
}
