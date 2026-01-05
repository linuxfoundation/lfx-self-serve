// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MAILING_LIST_TOTAL_STEPS } from '@lfx-one/shared/constants';
import { MailingListAudienceAccess, MailingListType } from '@lfx-one/shared/enums';
import { CreateGroupsIOServiceRequest, CreateMailingListRequest, GroupsIOMailingList, GroupsIOService, MailingListCommittee } from '@lfx-one/shared/interfaces';
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
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, CardComponent, StepperModule, MailingListBasicInfoComponent, MailingListSettingsComponent],
  templateUrl: './mailing-list-manage.component.html',
  styleUrl: './mailing-list-manage.component.scss',
})
export class MailingListManageComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);

  public readonly totalSteps = MAILING_LIST_TOTAL_STEPS;
  public readonly mode = signal<'create' | 'edit'>('create');
  public readonly mailingListId = signal<string | null>(null);
  public readonly isEditMode = computed(() => this.mode() === 'edit');
  public readonly currentStep = signal<number>(1);
  public readonly submitting = signal<boolean>(false);
  public readonly form = signal<FormGroup>(this.createFormGroup());
  public readonly mailingList = this.initializeMailingList();
  public readonly project = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());

  // Services state - reactively fetched when project changes
  public readonly servicesLoaded = signal<boolean>(false);
  public readonly availableServices = this.initializeServices();
  public readonly selectedService = computed(() => this.availableServices()[0] ?? null);
  public readonly hasNoServices = computed(() => !this.isEditMode() && this.servicesLoaded() && this.availableServices().length === 0);

  // Parent service tracking for shared service creation
  public readonly parentService = signal<GroupsIOService | null>(null);
  public readonly needsSharedServiceCreation = computed(
    () => this.parentService() !== null && this.availableServices().filter((service) => service.type === 'shared').length === 0
  );

  // Prefix calculation for shared services
  public readonly servicePrefix = computed(() => {
    if (this.needsSharedServiceCreation()) {
      const project = this.project();
      return project ? `${this.cleanSlug(project.slug)}` : '';
    }

    return this.selectedService()?.prefix || '';
  });

  // Max group name length accounting for prefix (total max is 34)
  public readonly maxGroupNameLength = computed(() => {
    const prefix = this.servicePrefix() + '-';
    return 34 - prefix.length;
  });

  // Track form changes reactively using toSignal
  public readonly formValue = toSignal(this.form().valueChanges, { initialValue: this.form().value });

  // Validation computed signals
  public readonly canGoPrevious = computed(() => this.currentStep() > 1);
  public readonly canGoNext = computed(() => {
    // Access formValue to trigger reactivity on form changes
    this.formValue();
    return this.currentStep() < this.totalSteps && this.canNavigateToStep(this.currentStep() + 1);
  });
  public readonly isFirstStep = computed(() => this.currentStep() === 1);
  public readonly isLastStep = computed(() => this.currentStep() === this.totalSteps);

  public nextStep(): void {
    if (this.canGoNext()) {
      this.currentStep.update((step) => step + 1);
    }
  }

  public previousStep(): void {
    if (this.canGoPrevious()) {
      this.currentStep.update((step) => step - 1);
    }
  }

  public goToStep(step: number | undefined): void {
    if (step !== undefined && step >= 1 && step <= this.totalSteps) {
      if (this.isEditMode() || step <= this.currentStep()) {
        this.currentStep.set(step);
      }
    }
  }

  public onCancel(): void {
    this.router.navigate(['/mailing-lists']);
  }

  public onSkip(): void {
    this.onSubmit();
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

  private createFormGroup(): FormGroup {
    return new FormGroup(
      {
        // Step 1: Basic Information
        group_name: new FormControl('', [Validators.required, Validators.minLength(3), Validators.maxLength(34), Validators.pattern(/^[a-zA-Z0-9_-]+$/)]),
        description: new FormControl('', [htmlRequiredValidator(), htmlMinLengthValidator(11), htmlMaxLengthValidator(500)]),

        // Step 2: Settings
        audience_access: new FormControl<MailingListAudienceAccess>(MailingListAudienceAccess.PUBLIC, [Validators.required]),
        type: new FormControl<MailingListType>(MailingListType.DISCUSSION_OPEN, [Validators.required]),
        allow_attachments: new FormControl<boolean>(true),
        public: new FormControl<boolean>(true, [Validators.required]),

        // Step 3: People & Groups
        committees: new FormControl<MailingListCommittee[]>([]),
      },
      { validators: announcementVisibilityValidator() }
    );
  }

  private initializeMailingList() {
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

  private populateFormWithMailingListData(mailingList: GroupsIOMailingList): void {
    this.form().patchValue({
      group_name: mailingList.group_name,
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
   * Initializes services signal reactively based on project changes
   * Falls back to parent project if no services found for current project
   */
  private initializeServices() {
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
