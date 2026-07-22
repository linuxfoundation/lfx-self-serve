// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import {
  CreatableArtifactConfig,
  CreatableArtifactType,
  CreatableCommittee,
  CreatableProject,
  CreatableTarget,
  LensItem,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { CreatePermissionService } from '@services/create-permission.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-create-artifact-dialog',
  imports: [ReactiveFormsModule, ProjectSelectorComponent, ButtonComponent],
  templateUrl: './create-artifact-dialog.component.html',
})
export class CreateArtifactDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly router = inject(Router);
  private readonly createPermissionService = inject(CreatePermissionService);
  private readonly messageService = inject(MessageService);

  // The artifact type is chosen in the rail popover and handed to the dialog as data;
  // this dialog only resolves the target (project/foundation/committee) for that fixed type.
  protected readonly artifact: CreatableArtifactConfig = this.resolveArtifact();

  // Header + primary CTA copy, e.g. "Create Meeting".
  protected readonly createLabel = `Create ${this.artifact.label}`;

  // Single control holding whichever target's uid is selected — project/foundation or committee.
  // `selectedTarget` below carries the discriminated target the uid resolves to.
  protected readonly form = new FormGroup({
    project: new FormControl<string | null>(null, { validators: [Validators.required] }),
  });

  // The picked target — drives both selectors' trigger label/checkmark. Set on itemSelected.
  protected readonly selectedTarget: WritableSignal<CreatableTarget | null> = signal<CreatableTarget | null>(null);

  // Reactive by reference: the rail button only renders once at least one list is non-empty, so
  // the dialog always opens populated — but reading the signal keeps it correct if it widens
  // while the dialog is open. Scoped to `artifact.targetKinds` — a project-only type (e.g. Group)
  // never surfaces committee targets even if the user holds committee-writer grants.
  protected readonly projectOptions: Signal<CreatableProject[]> = computed(() =>
    this.artifact.targetKinds.includes('project') ? this.createPermissionService.creatableProjects() : []
  );
  protected readonly committeeOptions: Signal<CreatableCommittee[]> = computed(() =>
    this.artifact.targetKinds.includes('committee') ? this.createPermissionService.creatableCommittees() : []
  );

  protected readonly showProjectSelector: Signal<boolean> = computed(() => this.artifact.targetKinds.includes('project'));
  protected readonly showCommitteeSelector: Signal<boolean> = computed(
    () => this.artifact.targetKinds.includes('committee') && this.committeeOptions().length > 0
  );

  // Writer-scoped options mapped to the selector's `LensItem` shape. Feeding this as the selector's
  // curated `items` input keeps each list scoped to targets the user holds `writer` on — never the
  // view-scoped NavigationService catalog the sidebar selector pulls by default.
  protected readonly projectSelectorItems: Signal<LensItem[]> = computed(() => this.projectOptions().map(projectToLensItem));
  protected readonly committeeSelectorItems: Signal<LensItem[]> = computed(() => this.committeeOptions().map(committeeToLensItem));

  // Drives the `[selectedProject]` checkmark binding on both selectors — a target selected in one
  // selector simply won't match any uid in the other's item list, so only the active one highlights.
  protected readonly selectedContext: Signal<ProjectContext | null> = computed(() => {
    const target = this.selectedTarget();
    if (!target) return null;
    return target.kind === 'project'
      ? { uid: target.uid, name: target.name, slug: target.slug, parent_uid: target.parent_uid, logoUrl: target.logoUrl }
      : { uid: target.uid, name: target.name, slug: target.uid, logoUrl: target.logoUrl };
  });

  public constructor() {
    // Auto-select when the user can create against exactly one target across both lists: pre-fill
    // the choice so the dialog opens with Continue enabled and the picker just shows the locked-in
    // row — no redundant open-and-pick for a list of one. The rail button only renders once at
    // least one list is non-empty, so this reflects the state the dialog opened in; if it later
    // widens, the user can still change the selection via either selector.
    const projects = this.projectOptions();
    const committees = this.committeeOptions();
    if (projects.length + committees.length === 1) {
      if (projects.length === 1) {
        this.applySelection({ kind: 'project', ...projects[0] });
      } else {
        this.applySelection({ kind: 'committee', ...committees[0] });
      }
    }
  }

  /** Bridge the project/foundation selector's `itemSelected` output into the shared form control. */
  public onProjectItemSelected(item: LensItem): void {
    const project = this.projectOptions().find((option) => option.uid === item.uid);
    this.applySelection(project ? { kind: 'project', ...project } : null);
  }

  /** Bridge the committee selector's `itemSelected` output into the shared form control. */
  public onCommitteeItemSelected(item: LensItem): void {
    const committee = this.committeeOptions().find((option) => option.uid === item.uid);
    this.applySelection(committee ? { kind: 'committee', ...committee } : null);
  }

  public onContinue(): void {
    const targetUid = this.form.controls.project.value;
    if (!targetUid) {
      return;
    }

    // The options are live signals, so the selection can disappear mid-dialog if a list narrows
    // while the form control keeps the old uid.
    const target = this.selectedTarget();
    if (!target || target.uid !== targetUid || !this.isTargetStillAvailable(target)) {
      this.failWith('That selection is no longer available. Please choose another.');
      return;
    }

    // Navigate by explicit selection rather than aligning the active lens first — the create-route
    // guards (`projectQueryParamGuard` + `writerGuard`) resolve the target from these query params
    // independently of the active lens, so no lens alignment step is needed here (see LFXV2-2755).
    if (target.kind === 'committee') {
      // `?project=` keeps `writerGuard` + slot-seeding working on the owning project; `committee_uid`
      // drives the committee lock + committee-writer authorization on the create page.
      this.router.navigate([this.artifact.createRoute], { queryParams: { project: target.projectSlug, committee_uid: target.uid } });
    } else {
      this.router.navigate([this.artifact.createRoute], { queryParams: { project: target.slug } });
    }
    this.dialogRef.close(true);
  }

  public cancel(): void {
    this.dialogRef.close(false);
  }

  /** Set (or clear) the current selection — drives both selectors' display and the Continue-gating control. */
  private applySelection(target: CreatableTarget | null): void {
    this.selectedTarget.set(target);
    this.form.controls.project.setValue(target?.uid ?? null);
    this.form.controls.project.markAsTouched();
  }

  /** True while the selected target is still present in its corresponding live options list. */
  private isTargetStillAvailable(target: CreatableTarget): boolean {
    return target.kind === 'project' ? this.projectOptions().some((p) => p.uid === target.uid) : this.committeeOptions().some((c) => c.uid === target.uid);
  }

  /** Surface a dead-end to the user and close, rather than leaving the CTA silently inert. */
  private failWith(detail: string): void {
    this.messageService.add({ severity: 'error', summary: `Cannot create ${this.artifact.label}`, detail });
    this.dialogRef.close(false);
  }

  private resolveArtifact(): CreatableArtifactConfig {
    const type = this.config.data?.type as CreatableArtifactType | undefined;
    const artifact = CREATABLE_ARTIFACTS.find((candidate) => candidate.type === type);
    if (!artifact) {
      // Only reachable if a caller opens the dialog with a bad type — a programming error. The
      // template needs a config, so fall back to the first, but say so loudly rather than let the
      // user quietly land on a create flow they never asked for.
      console.error('CreateArtifactDialogComponent opened without a valid artifact type.', { type });
      return CREATABLE_ARTIFACTS[0];
    }
    return artifact;
  }
}

/** Project a writer-scoped `CreatableProject` down to the selector's curated `LensItem` shape. */
function projectToLensItem(project: CreatableProject): LensItem {
  return { uid: project.uid, slug: project.slug, name: project.name, logoUrl: project.logoUrl ?? null, isFoundation: project.isFoundation };
}

/**
 * Project a writer-scoped `CreatableCommittee` down to the selector's curated `LensItem` shape.
 * `slug` has no committee-native meaning (committees aren't slug-addressed) — the committee uid is
 * reused there purely to satisfy the shape; navigation never reads it for committee targets, it
 * reads `projectSlug`/`uid` off the resolved `CreatableCommittee` directly (see `onContinue`).
 */
function committeeToLensItem(committee: CreatableCommittee): LensItem {
  return { uid: committee.uid, slug: committee.uid, name: committee.name, logoUrl: committee.logoUrl ?? null, isFoundation: false };
}
