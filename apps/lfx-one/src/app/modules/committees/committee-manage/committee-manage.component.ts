// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { COMMITTEE_FORM_STEPS, COMMITTEE_LABEL, COMMITTEE_STEP_TITLES, COMMITTEE_TOTAL_STEPS } from '@lfx-one/shared/constants';
import { Committee, MemberPendingChanges } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { StepperModule } from 'primeng/stepper';
import { BehaviorSubject, catchError, concat, filter, finalize, forkJoin, Observable, of, switchMap, take, toArray } from 'rxjs';

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
  private readonly destroyRef = inject(DestroyRef);

  // Mode and state signals
  public mode = signal<'create' | 'edit'>('create');
  public committeeId = signal<string | null>(null);
  public isEditMode = computed(() => this.mode() === 'edit');

  // Initialize committee data
  public committee = this.initializeCommittee();
  public project = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());

  // Member management state
  public memberUpdates = signal<MemberPendingChanges>({ toAdd: [], toUpdate: [], toDelete: [] });
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
  public readonly canProceed = signal<boolean>(false);
  public readonly canGoNext = computed(() => this.currentStep() + 1 < this.totalSteps && this.canNavigateToStep(this.currentStep() + 1));
  public readonly canGoPrevious = computed(() => this.currentStep() > 1);
  public readonly isFirstStep = computed(() => this.currentStep() === 1);
  public readonly isLastFormStep = computed(() => this.currentStep() === this.formSteps.SETTINGS);
  public readonly isLastStep = computed(() => this.currentStep() === this.totalSteps);
  public readonly currentStepTitle = computed(() => this.getStepTitle(this.currentStep()));
  public readonly hasMemberUpdates = computed(
    () => this.memberUpdates().toAdd.length > 0 || this.memberUpdates().toUpdate.length > 0 || this.memberUpdates().toDelete.length > 0
  );

  // UI labels
  public readonly committeeLabel = COMMITTEE_LABEL.singular;
  public readonly committeeLabelPlural = COMMITTEE_LABEL.plural;

  public constructor() {
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

    // Subscribe to form value changes and update validation signals
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateCanProceed();
    });

    // Effect for step changes - handles validation
    effect(() => {
      this.currentStep();
      this.updateCanProceed();
    });

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
      project_uid: this.project()?.uid || null,
    };

    const committeeData = this.cleanFormData(formValue);

    if (this.isEditMode() && this.committeeId()) {
      // Update existing committee
      this.committeeService.updateCommittee(this.committeeId()!, committeeData).subscribe({
        next: () => this.handleCommitteeSuccess('updated'),
        error: (error) => this.handleCommitteeError(error, 'update'),
      });
    } else {
      // Create new committee
      this.committeeService.createCommittee(committeeData).subscribe({
        next: (committee) => this.handleCreateSuccess(committee),
        error: (error) => this.handleCommitteeError(error, 'create'),
      });
    }
  }

  public onDone(): void {
    // Create mode - process member changes then navigate
    this.submitting.set(true);

    const operations = this.buildMemberOperations();

    // If no operations, just navigate
    if (operations.length === 0) {
      this.submitting.set(false);
      this.router.navigate(['/groups']);
      return;
    }

    // Execute operations sequentially using concat
    concat(...operations)
      .pipe(
        toArray(),
        finalize(() => this.submitting.set(false))
      )
      .subscribe({
        next: (results) => {
          const totalSuccess = results.reduce((sum, result) => sum + result.success, 0);
          const totalFailed = results.reduce((sum, result) => sum + result.failed, 0);

          this.showMemberOperationToast(totalSuccess, totalFailed, totalSuccess + totalFailed);
          this.router.navigate(['/groups']);
        },
        error: (error) => {
          console.error('Error processing member changes:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to save member changes',
          });
          this.router.navigate(['/groups']);
        },
      });
  }

  public onMemberUpdatesChange(updates: MemberPendingChanges): void {
    this.memberUpdates.set(updates);
  }

  public onSubmitAll(): void {
    // Edit mode only - save committee and members together using forkJoin
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
      project_uid: this.project()?.uid || null,
    };

    const committeeData = this.cleanFormData(formValue);

    // Prepare committee update
    const updateCommittee$ = this.committeeService.updateCommittee(this.committeeId()!, committeeData);

    // Prepare member operations
    const memberOperations = this.buildMemberOperations();
    const members$ = memberOperations.length > 0 ? concat(...memberOperations).pipe(toArray()) : of([]);

    // Execute both operations in parallel
    forkJoin({
      committee: updateCommittee$,
      members: members$,
    })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (result: { committee: Committee; members: { type: string; success: number; failed: number }[] }) => {
          const memberResults = result.members;

          // Calculate member operation results
          const totalSuccess = memberResults.reduce((sum: number, r: { type: string; success: number; failed: number }) => sum + r.success, 0);
          const totalFailed = memberResults.reduce((sum: number, r: { type: string; success: number; failed: number }) => sum + r.failed, 0);

          // Show success message
          if (totalSuccess > 0 || totalFailed > 0) {
            this.showMemberOperationToast(totalSuccess, totalFailed, totalSuccess + totalFailed);
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
        error: (error: unknown) => {
          console.error('Error saving committee and members:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: `Failed to update ${this.committeeLabel.toLowerCase()}. Please try again.`,
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
      joinable: false,
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
      joinable: new FormControl(false),
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

  private handleCommitteeError(error: unknown, operation: 'create' | 'update'): void {
    console.error(`Error ${operation} committee:`, error);
    this.submitting.set(false);

    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: `Failed to ${operation} ${this.committeeLabel.toLowerCase()}. Please try again.`,
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

  private updateCanProceed(): void {
    const isValid = this.isStepValid(this.currentStep());
    this.canProceed.set(isValid);
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

  private buildMemberOperations() {
    const operations: ReturnType<typeof this.createMemberOperation>[] = [];
    const committeeId = this.committeeId()!;
    const memberUpdates = this.memberUpdates();

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

  private createMemberOperation(type: string, operation: () => Observable<unknown>) {
    return operation().pipe(
      switchMap(() => of({ type, success: 1, failed: 0 })),
      catchError((error) => {
        console.error(`Error ${type} member:`, error);
        return of({ type, success: 0, failed: 1 });
      })
    );
  }

  private showMemberOperationToast(totalSuccess: number, totalFailed: number, totalOperations: number): void {
    if (totalSuccess === totalOperations) {
      // All successful
      this.messageService.add({
        severity: 'success',
        summary: 'Success',
        detail: `${this.committeeLabel} and ${totalSuccess} member(s) updated successfully`,
      });
    } else if (totalSuccess > 0 && totalFailed > 0) {
      // Partial success
      this.messageService.add({
        severity: 'warn',
        summary: 'Partial Success',
        detail: `${totalSuccess} member(s) updated successfully, ${totalFailed} failed`,
      });
    } else if (totalFailed === totalOperations) {
      // All failed
      this.messageService.add({
        severity: 'error',
        summary: 'Operation Failed',
        detail: `Failed to update ${totalFailed} member(s)`,
      });
    }
  }
}
