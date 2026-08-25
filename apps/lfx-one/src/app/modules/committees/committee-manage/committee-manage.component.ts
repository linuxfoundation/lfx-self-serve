// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal, Signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { COMMITTEE_FORM_STEPS, COMMITTEE_INVITE_CONCURRENCY, COMMITTEE_LABEL, COMMITTEE_STEP_TITLES, COMMITTEE_TOTAL_STEPS } from '@lfx-one/shared/constants';
import {
  Committee,
  CommitteeMember,
  EntityWithProject,
  MemberOperationResult,
  MemberOperationType,
  MemberPendingChanges,
  ProjectContext,
  SucceededMemberOperations,
} from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { StepperModule } from 'primeng/stepper';
import { catchError, concat, distinctUntilChanged, EMPTY, filter, finalize, from, map, merge, mergeMap, Observable, of, switchMap, take, toArray } from 'rxjs';
import { applyEntityProjectContext, syncEntityProjectContext } from '@shared/utils/entity-project-context.util';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { resolveEntityWriteSlug } from '@shared/utils/write-access.util';
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
  private readonly projectService = inject(ProjectService);
  private readonly destroyRef = inject(DestroyRef);
  // Mode and state signals
  public mode = signal<'create' | 'edit'>('create');
  public committeeId = signal<string | null>(null);
  public isEditMode = computed(() => this.mode() === 'edit');

  // Initialize committee data
  public committee = this.initializeCommittee();
  public project = computed(() => this.projectContextService.activeContext());
  // Committee → EntityWithProject adapter so the active project context syncs from the loaded
  // committee rather than the cookie-restored last-visited project (GH-1566).
  private readonly committeeEntityContext: Signal<EntityWithProject | null> = this.initializeCommitteeEntityContext();
  // Access predicate for evictOnWriteAccessLoss — keys the project-writer check off the
  // COMMITTEE's own project (the target writerGuard authorized against), not the transient
  // active context, so the context switch can't evict guard-admitted users mid-edit (GH-1566).
  private readonly writeAccess: Signal<boolean> = this.initWriteAccess();

  // Member management state
  public memberUpdates = signal<MemberPendingChanges>({ toAdd: [], toUpdate: [], toDelete: [], toInvite: [] });
  /**
   * uids of members whose delete failed on the most recent flush, owned here (rather than in the
   * members-manager child) so the failure survives the child remounting when the PrimeNG step
   * panel destroys/recreates it on navigation away from and back to step 4 (GH-1608 review).
   */
  public failedDeleteUids = signal<string[]>([]);
  // Reference to the mounted members-manager child so a partial flush failure can prune
  // successfully-applied items out of its local state without navigating away (GH-1608).
  private readonly membersManager = viewChild(CommitteeMembersManagerComponent);

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
    evictOnWriteAccessLoss(this.writeAccess);

    // Derive the project context from the loaded committee so a context-less edit link
    // (/project/groups/:id/edit without ?project=) lands in the committee's project, not the
    // cookie-restored last-visited project. The fallback covers BFF project-enrichment failure.
    // preferEntityKind: a foundation-owned group can be edited under a /project/* URL, so the
    // committee's own is_foundation (not the route prefix) picks the slot and re-points the route
    // lens kind (mirror: meeting-manage post-GH-1432).
    syncEntityProjectContext(this.committeeEntityContext, this.projectContextService, this.router, this.destroyRef, { preferEntityKind: true });
    this.initCommitteeContextFallback();

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
        this.router.navigate([], { queryParams: { step: step }, queryParamsHandling: 'merge' });
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
        this.router.navigate([], { queryParams: { step: next }, queryParamsHandling: 'merge' });
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
        this.router.navigate([], { queryParams: { step: previous }, queryParamsHandling: 'merge' });
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

    // flushMemberUpdates() wraps every operation in its own catchError, so this can only ever
    // emit a results array and complete — never error. Failures surface through the results
    // array (see showMemberOperationToast's partial-failure branch), not here.
    this.flushMemberUpdates()
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe((results) => {
        this.showMemberOperationToast(results);

        // Don't navigate away while any staged item failed — re-entering the wizard would lose
        // it. Prune the items that did succeed so a retry doesn't resubmit them (GH-1608).
        if (results.some((result) => !result.success)) {
          this.failedDeleteUids.set(results.filter((result) => result.type === 'delete' && !result.success).map((result) => result.identifier));
          this.membersManager()?.pruneSucceeded(this.computeSucceededOperations(results));
          return;
        }

        this.router.navigate(['/groups']);
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
        next: (result: { committee: Committee; members: MemberOperationResult[] }) => {
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

          // Don't navigate away while any staged item failed — re-entering the wizard would lose
          // it. Prune the items that did succeed so a retry doesn't resubmit them (GH-1608).
          if (memberResults.some((memberResult) => !memberResult.success)) {
            this.failedDeleteUids.set(
              memberResults.filter((memberResult) => memberResult.type === 'delete' && !memberResult.success).map((memberResult) => memberResult.identifier)
            );
            this.membersManager()?.pruneSucceeded(this.computeSucceededOperations(memberResults));
            return;
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

  /**
   * Maps the loaded committee to the {@link EntityWithProject} shape consumed by
   * syncEntityProjectContext — pre-enrichment payloads can lack the project fields entirely,
   * so absent values map to null there (mirror: meeting-manage's initializeMeetingEntityContext;
   * Committee already carries `uid`, so no id remap is needed).
   */
  private initializeCommitteeEntityContext(): Signal<EntityWithProject | null> {
    return computed(() => {
      const committee = this.committee();
      if (!committee) {
        return null;
      }
      return {
        uid: committee.uid,
        project_uid: committee.project_uid,
        project_slug: committee.project_slug,
        project_name: committee.project_name,
        foundation_name: committee.foundation_name,
        is_foundation: committee.is_foundation ?? null,
      };
    });
  }

  /**
   * Fallback context sync for when the BFF project enrichment failed (the detail payload has
   * `project_uid` but no `project_slug`): resolve the project by uid and set context from it.
   * `getProject(uid, false)` — `current: false` so the fetch doesn't clobber ProjectService's
   * shared `project` state — resolves to null on failure, so a failed fallback leaves the
   * (stale) context untouched rather than erroring the page. (Mirror: meeting-manage's
   * initMeetingContextFallback, minus its fresh-detail last resort: `getCommitteeDetail` does
   * support `skipCache`, but a refetch cannot recover a missing `project_slug` — the BFF's
   * committee enrichment resolves the project through the same relation-gated `/projects/:uid`
   * GET this fallback already tried, unlike meeting enrichment's ungated query-service lookup.)
   *
   * Runs whenever the payload lacks `project_slug`, even when the uid already matches the active
   * context: the lookup is also what corrects the lens *kind* via `computeIsFoundation`. As in
   * syncEntityProjectContext, NavigationEnd re-applies the correction: query-param step
   * navigations re-assert the route's declared kind via syncLensFromRoute without re-running
   * guards. The re-apply hits the shareReplay-cached getProject, so it costs no extra request.
   */
  private initCommitteeContextFallback(): void {
    const unresolvedEntity$ = toObservable(this.committeeEntityContext).pipe(
      distinctUntilChanged((a, b) => a?.uid === b?.uid && a?.project_uid === b?.project_uid)
    );
    const navigationReapply$ = this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.committeeEntityContext())
    );
    merge(unresolvedEntity$, navigationReapply$)
      .pipe(
        filter((entity): entity is EntityWithProject => !!entity?.project_uid && !entity.project_slug),
        switchMap((entity) => this.projectService.getProject(entity.project_uid, false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((project) => {
        if (!project) {
          // Relation-gated or failed lookup — nothing more to try; the context self-corrects on
          // the next navigation once the detail payload carries its slug again.
          return;
        }
        const context: ProjectContext = { uid: project.uid, name: project.name, slug: project.slug };
        // Mirror syncEntityProjectContext: only write ?project= to the URL when already present.
        const syncUrl = 'project' in this.router.parseUrl(this.router.url).queryParams;
        applyEntityProjectContext(this.projectContextService, context, computeIsFoundation(project), syncUrl);
      });
  }

  /**
   * Access predicate for evictOnWriteAccessLoss — mirrors writerGuard's committees standard
   * (project writer only: 'committees' is not in COMMITTEE_WRITE_FEATURES, so no committee-writer
   * leg, and meetingCoordinator doesn't apply to this feature) so the context switch to the
   * committee's project doesn't evict guard-admitted users.
   *
   * In edit mode the leg keys off the COMMITTEE's own project (slug, falling back to uid — the
   * BFF getProject route sniffs UUIDs), the same target writerGuard authorized against. Keying
   * off activeContext instead would evaluate the stale cookie-restored boot context, and its
   * false could win the race against syncEntityProjectContext's correction (a cached boot project
   * resolves faster than the committee fetch that triggers the switch). Create mode has no
   * committee, so the guard-checked active context (?project=) is the key.
   *
   * The leg is pending (undefined) until its first resolution, and the predicate stays
   * provisionally true while pending — writerGuard already authorized this navigation, so an
   * unresolved leg is not an access-lost signal (mirror: meeting-manage's initWriteAccess).
   */
  private initWriteAccess(): Signal<boolean> {
    const editCommitteeId = this.route.snapshot.paramMap.get('id');
    const projectKey$: Observable<string | null | undefined> = editCommitteeId
      ? toObservable(this.committee).pipe(
          map((committee) => {
            if (!committee) {
              // Pending — in edit mode the authorization target comes from the committee itself.
              return undefined;
            }
            // Mirror writerGuard's resolution order via the shared helper — when the guard and
            // the reactive access signals each carried their own copy, drift evicted admitted
            // users. The active-context fallback covers a committee carrying neither slug nor uid
            // (the manage component owns that error path).
            return resolveEntityWriteSlug(committee, this.projectContextService.activeContext()?.slug ?? null);
          })
        )
      : toObservable(this.projectContextService.activeContext).pipe(map((ctx) => ctx?.slug ?? null));

    const projectAccess = toSignal(
      projectKey$.pipe(
        filter((key): key is string | null => key !== undefined),
        distinctUntilChanged(),
        switchMap((key) => {
          if (!key) {
            return of(false);
          }
          return this.projectService.getProject(key, false).pipe(
            map((project) => project?.writer === true),
            catchError(() => of(false))
          );
        })
      )
      // No initialValue: undefined doubles as the leg's pending state (see the doc above).
    );
    return computed(() => projectAccess() !== false);
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
      this.router.navigate([], { queryParams: { step: this.formSteps.ADD_MEMBERS }, queryParamsHandling: 'merge' });
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
        operations.push(this.createMemberOperation('delete', memberId, () => this.committeeService.deleteCommitteeMember(committeeId, memberId)));
      }
    }

    // Add update operation if there are members to update
    if (memberUpdates.toUpdate.length > 0) {
      for (const update of memberUpdates.toUpdate) {
        operations.push(
          this.createMemberOperation('update', update.uid, () => this.committeeService.updateCommitteeMember(committeeId, update.uid, update.changes))
        );
      }
    }

    // Add create operation if there are members to add
    if (memberUpdates.toAdd.length > 0) {
      for (const member of memberUpdates.toAdd) {
        operations.push(
          this.createMemberOperation(
            'add',
            member.email,
            () => this.committeeService.createCommitteeMember(committeeId, member),
            (createdMember) => createdMember
          )
        );
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
  private flushMemberUpdates(): Observable<MemberOperationResult[]> {
    const committeeId = this.committeeId()!;
    const memberUpdates = this.memberUpdates();

    const memberOperations = this.buildMemberOperations(committeeId, memberUpdates);
    const memberOps$ = memberOperations.length > 0 ? concat(...memberOperations) : EMPTY;

    const invites = memberUpdates.toInvite;
    const inviteOps$ =
      invites.length > 0
        ? from(invites).pipe(
            mergeMap(
              (invite) => this.createMemberOperation('invite', invite.invitee_email, () => this.committeeService.createCommitteeInvite(committeeId, invite)),
              COMMITTEE_INVITE_CONCURRENCY
            )
          )
        : EMPTY;

    return concat(memberOps$, inviteOps$).pipe(toArray());
  }

  private createMemberOperation<T>(
    type: MemberOperationType,
    identifier: string,
    operation: () => Observable<T>,
    captureMember?: (result: T) => CommitteeMember
  ): Observable<MemberOperationResult> {
    return operation().pipe(
      switchMap((result) => of({ type, identifier, success: true, createdMember: captureMember?.(result) })),
      catchError(() => of({ type, identifier, success: false }))
    );
  }

  /** Groups the identifiers of successfully-flushed operations so the members-manager child can prune them (GH-1608). */
  private computeSucceededOperations(results: MemberOperationResult[]): SucceededMemberOperations {
    const succeeded = results.filter((result) => result.success);

    return {
      addedMembers: new Map(
        succeeded.flatMap((result) =>
          result.type === 'add' && result.createdMember ? [[(result.identifier ?? '').trim().toLowerCase(), result.createdMember] as const] : []
        )
      ),
      updatedUids: new Set(succeeded.filter((result) => result.type === 'update').map((result) => result.identifier)),
      deletedUids: new Set(succeeded.filter((result) => result.type === 'delete').map((result) => result.identifier)),
      invitedEmails: new Set(succeeded.filter((result) => result.type === 'invite').map((result) => (result.identifier ?? '').trim().toLowerCase())),
    };
  }

  private showMemberOperationToast(results: MemberOperationResult[]): void {
    const totalSuccess = results.filter((result) => result.success).length;
    const totalFailed = results.filter((result) => !result.success).length;
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
