// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import { CreatableArtifactConfig, CreatableArtifactType, CreatableProject, LensItem, ProjectContext } from '@lfx-one/shared/interfaces';
import { CreatePermissionService } from '@services/create-permission.service';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
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
  private readonly projectContextService = inject(ProjectContextService);
  private readonly createPermissionService = inject(CreatePermissionService);
  private readonly lensService = inject(LensService);
  private readonly messageService = inject(MessageService);

  // The artifact type is chosen in the rail popover and handed to the dialog as data;
  // this dialog only resolves the project/foundation for that fixed type.
  protected readonly artifact: CreatableArtifactConfig = this.resolveArtifact();

  // Header + primary CTA copy, e.g. "Create Meeting".
  protected readonly createLabel = `Create ${this.artifact.label}`;

  protected readonly form = new FormGroup({
    project: new FormControl<string | null>(null, { validators: [Validators.required] }),
  });

  // The picked project — drives the selector's trigger label/checkmark. Set on itemSelected.
  protected readonly selectedContext: WritableSignal<ProjectContext | null> = signal<ProjectContext | null>(null);

  // Reactive by reference: the rail button only renders once this list is non-empty, so the
  // dialog always opens populated — but reading the signal keeps it correct if it widens
  // (e.g. persona data resolving and unlocking another lens) while the dialog is open.
  protected readonly projectOptions: Signal<CreatableProject[]> = this.createPermissionService.creatableProjects;

  // Writer-scoped options mapped to the selector's `LensItem` shape. Feeding this as the selector's
  // curated `items` input keeps the list scoped to projects the user holds `writer` on — never the
  // view-scoped NavigationService catalog the sidebar selector pulls by default.
  protected readonly selectorItems: Signal<LensItem[]> = computed(() =>
    this.projectOptions().map((project) => ({
      uid: project.uid,
      slug: project.slug,
      name: project.name,
      logoUrl: project.logoUrl ?? null,
      isFoundation: project.isFoundation,
    }))
  );

  public constructor() {
    // Auto-select when the user can create on exactly one project/foundation: pre-fill the choice so the
    // dialog opens with Continue enabled and the picker just shows the locked-in row — no redundant
    // open-and-pick for a list of one. The rail button only renders once the list is non-empty, so this
    // reflects the state the dialog opened in; if it later widens (persona data resolving), the user can
    // still change the selection via the selector.
    const options = this.projectOptions();
    if (options.length === 1) {
      this.applySelection(options[0]);
    }
  }

  /** Bridge the selector's `itemSelected` output into the form control that gates the Continue CTA. */
  public onItemSelected(item: LensItem): void {
    this.applySelection(this.projectOptions().find((option) => option.uid === item.uid) ?? null);
  }

  public onContinue(): void {
    const projectUid = this.form.controls.project.value;
    if (!projectUid) {
      return;
    }

    // The options are a live signal, so the selection can disappear mid-dialog if the list
    // narrows (e.g. a persona refresh dropping a lens) while the form control keeps the old uid.
    const project = this.projectOptions().find((option) => option.uid === projectUid);
    if (!project) {
      this.failWith('That project is no longer available. Please choose another.');
      return;
    }

    const context: ProjectContext = this.toContext(project);

    // `activeContext` is lens-gated: under `me`/`org` it reads the slot matching the user's
    // *persona*, not the kind picked here, so the create page would resolve the other slot.
    // Aligning the lens first makes it read the slot seeded below.
    //
    // This should now always succeed: the options are exactly the user's `writer` grants, and
    // `getAllowedLensIds` admits any lens they hold `writer` within (LFXV2-2754), so the lens
    // for a listed project is available by construction. It previously failed for real users —
    // the lens came from persona alone, which a writer grant does not imply — which is the bug
    // this path was fixed for. Kept as a defensive bail because the alternative on an
    // unexpected refusal is creating against a stale project, which `writerGuard`'s ED
    // fast-path would not catch.
    if (!this.lensService.setLens(project.isFoundation ? 'foundation' : 'project')) {
      console.error('Cannot align lens to the selected project; aborting create navigation.', {
        slug: project.slug,
        isFoundation: project.isFoundation,
      });
      this.failWith(`You don't have access to create in ${project.name}.`);
      return;
    }

    // Seed the slot matching the selection's kind. `syncUrl: false` because the default rewrites
    // the *current* page's history entry via replaceState — the dialog is global to the rail, so
    // that would re-point whatever page the user opened it from. `router.navigate` carries the
    // slug to the destination instead.
    if (project.isFoundation) {
      this.projectContextService.setFoundation(context, false);
    } else {
      this.projectContextService.setProject(context, false);
    }

    // The slug keeps writerGuard authoritative on the chosen project and lets
    // projectQueryParamGuard re-seed real project data on the lens-prefixed mounts.
    this.router.navigate([this.artifact.createRoute], { queryParams: { project: project.slug } });
    this.dialogRef.close(true);
  }

  public cancel(): void {
    this.dialogRef.close(false);
  }

  /** Set (or clear) the current selection — drives the selector's display and the Continue-gating control. */
  private applySelection(project: CreatableProject | null): void {
    this.selectedContext.set(project ? this.toContext(project) : null);
    this.form.controls.project.setValue(project?.uid ?? null);
    this.form.controls.project.markAsTouched();
  }

  /** Project a writer-scoped `CreatableProject` down to the `ProjectContext` the context service stores. */
  private toContext(project: CreatableProject): ProjectContext {
    return { uid: project.uid, name: project.name, slug: project.slug, parent_uid: project.parent_uid, logoUrl: project.logoUrl };
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
