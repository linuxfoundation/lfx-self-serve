// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CommitteeSelectorComponent } from '@components/committee-selector/committee-selector.component';
import { COMMITTEE_LABEL, MAILING_LIST_TOTAL_STEPS } from '@lfx-one/shared/constants';
import { MailingListAudienceAccess, MailingListType } from '@lfx-one/shared/enums';
import { CommitteeReference, CreateGroupsIOServiceRequest, CreateMailingListRequest, GroupsIOMailingList, GroupsIOService } from '@lfx-one/shared/interfaces';
import { markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { announcementVisibilityValidator, htmlMaxLengthValidator, htmlMinLengthValidator, htmlRequiredValidator } from '@lfx-one/shared/validators';
import { MailingListService } from '@services/mailing-list.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { StepperModule } from 'primeng/stepper';
import { catchError, filter, Observable, of, switchMap, tap, throwError } from 'rxjs';

import { MailingListBasicInfoComponent } from '../components/mailing-list-basic-info/mailing-list-basic-info.component';
import { MailingListSettingsComponent } from '../components/mailing-list-settings/mailing-list-settings.component';

@Component({
  selector: 'lfx-mailing-list-manage',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    StepperModule,
    MailingListBasicInfoComponent,
    MailingListSettingsComponent,
    CommitteeSelectorComponent,
  ],
  templateUrl: './mailing-list-manage.component.html',
  styleUrl: './mailing-list-manage.component.scss',
})
export class MailingListManageComponent {
  // Private injections
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);

  // Protected constants
  public readonly totalSteps = MAILING_LIST_TOTAL_STEPS;
  public readonly committeeLabel = COMMITTEE_LABEL;

  // Form
  public readonly form = signal<FormGroup>(this.createFormGroup());

  // Simple WritableSignals
  public readonly mode = signal<'create' | 'edit'>('create');
  public readonly mailingListId = signal<string | null>(null);
  public readonly submitting = signal<boolean>(false);
  public readonly servicesLoaded = signal<boolean>(false);
  public readonly parentService = signal<GroupsIOService | null>(null);
  private readonly internalStep = signal<number>(1);

  // Complex computed/toSignal signals
  public readonly isEditMode: Signal<boolean> = this.initIsEditMode();
  public readonly mailingList: Signal<GroupsIOMailingList | null> = this.initMailingList();
  public readonly project: Signal<ReturnType<typeof this.projectContextService.selectedProject>> = this.initProject();
  public readonly availableServices: Signal<GroupsIOService[]> = this.initServices();
  public readonly selectedService: Signal<GroupsIOService | null> = this.initSelectedService();
  public readonly needsSharedServiceCreation: Signal<boolean> = this.initNeedsSharedServiceCreation();
  public readonly servicePrefix: Signal<string> = this.initServicePrefix();
  public readonly maxGroupNameLength: Signal<number> = this.initMaxGroupNameLength();
  public readonly formValue: Signal<Record<string, unknown>> = this.initFormValue();
  public readonly canGoPrevious: Signal<boolean> = this.initCanGoPrevious();
  public readonly canGoNext: Signal<boolean> = this.initCanGoNext();
  public readonly isFirstStep: Signal<boolean> = this.initIsFirstStep();
  public readonly isLastStep: Signal<boolean> = this.initIsLastStep();
  public readonly initialPublicValue: Signal<boolean | null> = this.initInitialPublicValue();
  public currentStep: Signal<number> = this.initCurrentStep();

  public nextStep(): void {
    const next = this.currentStep() + 1;
    if (next <= this.totalSteps && this.canNavigateToStep(next)) {
      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step: next } });
      } else {
        this.internalStep.set(next);
      }
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
    }
  }

  public goToStep(step: number | undefined): void {
    if (step !== undefined && step >= 1 && step <= this.totalSteps) {
      if (this.isEditMode()) {
        // In edit mode, allow navigation to any step via query params
        this.router.navigate([], { queryParams: { step } });
      } else if (step <= this.currentStep()) {
        // In create mode, only allow going back to previous steps
        this.internalStep.set(step);
      }
    }
  }

  public onCancel(): void {
    this.router.navigate(['/mailing-lists']);
  }

  public onSubmit(): void {
    if (this.form().invalid) {
      markFormControlsAsTouched(this.form());
      return;
    }

    this.submitting.set(true);

    // Determine if we need to create a shared service first
    const serviceCreation$: Observable<GroupsIOService | null> =
      this.needsSharedServiceCreation() && !this.isEditMode() ? this.createSharedService() : of(null);

    serviceCreation$
      .pipe(
        switchMap((newService: GroupsIOService | null) => {
          const service = newService ?? this.selectedService();
          const data = this.prepareMailingListData(service);

          return this.isEditMode() ? this.mailingListService.updateMailingList(this.mailingListId()!, data) : this.mailingListService.createMailingList(data);
        })
      )
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `Mailing list ${this.isEditMode() ? 'updated' : 'created'} successfully`,
          });
          this.router.navigate(['/mailing-lists']);
        },
        error: (error: Error) => {
          const isServiceError = error?.message?.includes('service');
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: isServiceError
              ? 'Failed to create mailing list service for this project'
              : `Failed to ${this.isEditMode() ? 'update' : 'create'} mailing list`,
          });
          this.submitting.set(false);
        },
      });
  }

  public isCurrentStepValid(): boolean {
    return this.isStepValid(this.currentStep());
  }

  // Private initializer functions
  private createFormGroup(): FormGroup {
    return new FormGroup(
      {
        // Step 1: Basic Information
        group_name: new FormControl('', [Validators.required, Validators.minLength(3), Validators.maxLength(34), Validators.pattern(/^[a-zA-Z0-9_-]+$/)]),
        description: new FormControl('', [htmlRequiredValidator(), htmlMinLengthValidator(11), htmlMaxLengthValidator(500)]),

        // Step 2: Settings
        audience_access: new FormControl<MailingListAudienceAccess>(MailingListAudienceAccess.PUBLIC, [Validators.required]),
        type: new FormControl<MailingListType>(MailingListType.DISCUSSION_OPEN, [Validators.required]),
        public: new FormControl<boolean>(true, [Validators.required]),

        // Step 3: People & Groups
        committees: new FormControl<CommitteeReference[]>([]),
      },
      { validators: announcementVisibilityValidator() }
    );
  }

  private initIsEditMode(): Signal<boolean> {
    return computed(() => this.mode() === 'edit');
  }

  private initMailingList(): Signal<GroupsIOMailingList | null> {
    return toSignal(
      this.route.paramMap.pipe(
        switchMap((params) => {
          const mailingListId = params.get('id');
          if (mailingListId) {
            this.mode.set('edit');
            this.mailingListId.set(mailingListId);
            return this.mailingListService.getMailingList(mailingListId).pipe(
              catchError(() => {
                this.messageService.add({
                  severity: 'error',
                  summary: 'Error',
                  detail: 'Mailing list not found',
                });
                this.router.navigate(['/mailing-lists']);
                return of(null);
              }),
              tap((mailingList) => {
                if (mailingList) {
                  this.populateFormWithMailingListData(mailingList);
                }
              })
            );
          }
          this.mode.set('create');
          return of(null);
        })
      ),
      { initialValue: null }
    );
  }

  private initProject(): Signal<ReturnType<typeof this.projectContextService.selectedProject>> {
    return computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  }

  private initServices(): Signal<GroupsIOService[]> {
    return toSignal(
      toObservable(this.project).pipe(
        tap(() => {
          this.servicesLoaded.set(false);
          this.parentService.set(null);
        }),
        filter((project): project is NonNullable<typeof project> => project !== null),
        switchMap((project) =>
          this.mailingListService.getServicesByProject(project.uid).pipe(
            switchMap((services) => {
              if (services.length > 0) {
                // Current project has services, no need to create shared service
                this.parentService.set(null);
                return of(services);
              }

              // No services found, fetch full project to get parent_uid
              return this.projectService.getProject(project.slug, false).pipe(
                switchMap((fullProject) => {
                  if (!fullProject?.parent_uid) {
                    return of([]);
                  }

                  // Fetch services from parent project
                  return this.mailingListService.getServicesByProject(fullProject.parent_uid).pipe(
                    tap((parentServices) => {
                      // If parent has services, store the first one for shared service creation
                      if (parentServices.length > 0) {
                        this.parentService.set(parentServices[0]);
                      }
                    })
                  );
                }),
                catchError(() => of([]))
              );
            }),
            tap(() => this.servicesLoaded.set(true)),
            catchError(() => {
              this.servicesLoaded.set(true);
              return of([]);
            })
          )
        )
      ),
      { initialValue: [] }
    );
  }

  private initSelectedService(): Signal<GroupsIOService | null> {
    return computed(() => this.availableServices()[0] ?? null);
  }

  private initNeedsSharedServiceCreation(): Signal<boolean> {
    return computed(() => this.parentService() !== null && this.availableServices().filter((service) => service.type === 'shared').length === 0);
  }

  private initServicePrefix(): Signal<string> {
    return computed(() => {
      if (this.needsSharedServiceCreation()) {
        const project = this.project();
        return project ? `${this.cleanSlug(project.slug)}` : '';
      }

      return this.selectedService()?.prefix || '';
    });
  }

  private initMaxGroupNameLength(): Signal<number> {
    return computed(() => {
      const prefix = this.servicePrefix() + '-';
      return 34 - prefix.length;
    });
  }

  private initFormValue(): Signal<Record<string, unknown>> {
    return toSignal(this.form().valueChanges, { initialValue: this.form().value });
  }

  private initCanGoPrevious(): Signal<boolean> {
    return computed(() => this.currentStep() > 1);
  }

  private initCanGoNext(): Signal<boolean> {
    return computed(() => {
      // Access formValue to trigger reactivity on form changes
      this.formValue();
      return this.currentStep() < this.totalSteps && this.canNavigateToStep(this.currentStep() + 1);
    });
  }

  private initIsFirstStep(): Signal<boolean> {
    return computed(() => this.currentStep() === 1);
  }

  private initIsLastStep(): Signal<boolean> {
    return computed(() => this.currentStep() === this.totalSteps);
  }

  private initInitialPublicValue(): Signal<boolean | null> {
    return computed(() => this.mailingList()?.public ?? null);
  }

  private initCurrentStep(): Signal<number> {
    return toSignal(
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
  }

  private populateFormWithMailingListData(mailingList: GroupsIOMailingList): void {
    // Strip prefix from group_name in edit mode to prevent double-prefixing on submit
    // The prefix is added back in prepareMailingListData when submitting
    let groupName = mailingList.group_name;
    const servicePrefix = mailingList.service?.prefix;

    if (servicePrefix && mailingList.service?.type !== 'primary') {
      const prefixWithSeparator = `${servicePrefix}-`;
      if (groupName.startsWith(prefixWithSeparator)) {
        groupName = groupName.slice(prefixWithSeparator.length);
      }
    }

    this.form().patchValue({
      group_name: groupName,
      description: mailingList.description || '',
      audience_access: mailingList.audience_access || MailingListAudienceAccess.PUBLIC,
      type: mailingList.type || MailingListType.DISCUSSION_OPEN,
      public: mailingList.public ?? true,
      committees: mailingList.committees || [],
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
    const form = this.form();

    switch (step) {
      case 1: {
        const groupNameValid = !!form.get('group_name')?.valid;
        const descriptionValid = !!form.get('description')?.valid;
        const groupNameLength = (form.get('group_name')?.value || '').length;
        const groupNameLengthValid = groupNameLength <= this.maxGroupNameLength();
        return groupNameValid && descriptionValid && groupNameLengthValid;
      }
      case 2: {
        const fieldsValid = !!(form.get('audience_access')?.valid && form.get('type')?.valid && form.get('public')?.valid);
        // Check form-level validation errors (e.g., announcement visibility constraint)
        const formLevelValid = !form.hasError('announcementRequiresPublicVisibility');
        return fieldsValid && formLevelValid;
      }
      case 3:
        return true; // Optional step
      default:
        return false;
    }
  }

  private prepareMailingListData(service: GroupsIOService | null): CreateMailingListRequest {
    const formValue = this.form().value;
    const prefix = this.servicePrefix() || this.cleanSlug(this.project()?.slug || '');
    const groupName = service?.type === 'primary' ? formValue.group_name : `${prefix}-${formValue.group_name}`;

    return {
      group_name: groupName,
      public: formValue.public,
      type: formValue.type,
      audience_access: formValue.audience_access,
      description: formValue.description || '',
      service_uid: service?.uid ?? '',
      committees: formValue.committees?.length > 0 ? formValue.committees : undefined,
      title: formValue.group_name,
    };
  }

  /**
   * Cleans a project slug for use as a prefix
   * Replaces underscores with hyphens and removes leading/trailing hyphens
   */
  private cleanSlug(slug: string): string {
    return slug?.replace(/_/g, '-').replace(/^-*|-*$/g, '') || '';
  }

  /**
   * Creates a shared service for the current project based on parent service
   */
  private createSharedService(): Observable<GroupsIOService> {
    const parent = this.parentService();
    const project = this.project();

    if (!parent || !project) {
      return throwError(() => new Error('Parent service or project not available'));
    }

    const serviceData: CreateGroupsIOServiceRequest = {
      type: 'shared',
      prefix: `${this.cleanSlug(project.slug)}`,
      project_uid: project.uid,
      domain: parent.domain,
    };

    return this.mailingListService.createService(serviceData);
  }
}
