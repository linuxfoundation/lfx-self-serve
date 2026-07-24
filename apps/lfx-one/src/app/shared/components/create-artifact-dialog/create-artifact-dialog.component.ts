// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CreateTargetPickerComponent } from '@components/create-target-picker/create-target-picker.component';
import { COMMITTEE_WRITE_ARTIFACT_TYPES, CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import { CreatableArtifactConfig, CreatableArtifactType, CreatePickerNode, ProjectContext } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Create-flow target picker dialog (LFXV2-2838 rebuild). Resolves the create target explicitly
 * from the picker's selection — a pre-authorized project or committee row (direct-grant tree or
 * batch-access-checked search result) — rather than curating a writer-scoped project list and
 * gating navigation on whether the current persona happens to hold a matching lens. There is no
 * "you don't have access" dead end here: every row the picker renders already passed an access
 * check, so a selection is always safe to act on.
 */
@Component({
  selector: 'lfx-create-artifact-dialog',
  imports: [CreateTargetPickerComponent, ButtonComponent],
  templateUrl: './create-artifact-dialog.component.html',
})
export class CreateArtifactDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly router = inject(Router);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly lensService = inject(LensService);

  // The artifact type is chosen in the rail popover and handed to the dialog as data;
  // this dialog only resolves the project/committee target for that fixed type.
  protected readonly artifact: CreatableArtifactConfig = this.resolveArtifact();

  // Header + primary CTA copy, e.g. "Create Meeting".
  protected readonly createLabel = `Create ${this.artifact.label}`;

  // Only meeting/survey/vote allow a committee-scoped writer to create against them — the picker
  // label shouldn't promise "Group" as an option for types that can't actually target one.
  protected readonly targetLabel = COMMITTEE_WRITE_ARTIFACT_TYPES.includes(this.artifact.type)
    ? 'Select Foundation/Project/Group'
    : 'Select Foundation/Project';

  protected readonly selectedTarget: WritableSignal<CreatePickerNode | null> = signal<CreatePickerNode | null>(null);
  protected readonly canContinue: Signal<boolean> = computed(() => this.selectedTarget() !== null);

  public onTargetSelected(node: CreatePickerNode): void {
    this.selectedTarget.set(node);
  }

  // The picker's active result set just changed out from under the current pick (new search term,
  // or a switch between tree/search view) — clear it so Continue can't fire on a row that's no
  // longer visible or selectable.
  public onSelectionCleared(): void {
    this.selectedTarget.set(null);
  }

  public onContinue(): void {
    const target = this.selectedTarget();
    if (!target) {
      return;
    }

    // Aligns `activeContext`'s lens-gated slot and the route prefix to the picked target's kind,
    // WITHOUT the persona-allowed-lens rejection `setLens()` applies elsewhere — the picker
    // already proved access to this specific target, so gating on the persona's lens set here
    // would only reject legitimate, already-authorized picks. See LensService.setContextLens.
    this.lensService.setContextLens(target.isFoundation ? 'foundation' : 'project');

    // `syncUrl: false` because the default rewrites the *current* page's history entry via
    // replaceState — the dialog is global to the rail, so that would re-point whatever page the
    // user opened it from. `router.navigate` carries the slug (and committee_uid) to the
    // destination instead.
    if (target.kind === 'project') {
      const context: ProjectContext = { uid: target.uid, name: target.name, slug: target.slug };
      this.setContext(target.isFoundation, context);
      this.router.navigate([this.artifact.createRoute], { queryParams: { project: target.slug } });
    } else {
      const context: ProjectContext = { uid: target.projectUid, name: target.projectName, slug: target.projectSlug };
      this.setContext(target.isFoundation, context);
      this.router.navigate([this.artifact.createRoute], { queryParams: { project: target.projectSlug, committee_uid: target.uid } });
    }

    this.dialogRef.close(true);
  }

  public cancel(): void {
    this.dialogRef.close(false);
  }

  private setContext(isFoundation: boolean, context: ProjectContext): void {
    if (isFoundation) {
      this.projectContextService.setFoundation(context, false);
    } else {
      this.projectContextService.setProject(context, false);
    }
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
