// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CreatableArtifactType, CreatePickerNode } from '@lfx-one/shared/interfaces';
import { CreateTargetPickerService } from '@services/create-target-picker.service';
import { Subscription } from 'rxjs';

/**
 * One row of the create picker's lazy direct-grant tree — recursively renders its own children
 * once expanded. Both `project` and `committee` nodes can have children (subprojects +
 * committees under a project; child committees under a committee), so this is a single
 * self-referencing component rather than separate project/committee renderers.
 */
@Component({
  selector: 'lfx-create-target-tree-node',
  imports: [CreateTargetTreeNodeComponent],
  templateUrl: './create-target-tree-node.component.html',
})
export class CreateTargetTreeNodeComponent {
  private readonly pickerService = inject(CreateTargetPickerService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly node = input.required<CreatePickerNode>();
  public readonly artifactType = input.required<CreatableArtifactType>();
  public readonly depth = input(0);
  public readonly selectedKey = input<string | null>(null);

  public readonly nodeSelected = output<CreatePickerNode>();

  protected readonly expanded: WritableSignal<boolean> = signal(false);
  protected readonly loadingChildren: WritableSignal<boolean> = signal(false);
  protected readonly childrenLoaded: WritableSignal<boolean> = signal(false);
  // Distinct from `children().length === 0`: a confirmed-empty leaf (successful load, zero
  // children) must not retry on every re-expand the way a genuinely failed request should.
  protected readonly loadFailed: WritableSignal<boolean> = signal(false);
  protected readonly children: WritableSignal<CreatePickerNode[]> = signal<CreatePickerNode[]>([]);

  // Tracks the in-flight getChildren() request so a retry (collapse + re-expand before the first
  // one resolves) cancels it instead of racing it — otherwise a slow first response landing after
  // a successful retry can overwrite `children` with its own (possibly empty) result.
  private childrenSubscription?: Subscription;

  protected readonly key: Signal<string> = computed(() => `${this.node().kind}:${this.node().uid}`);
  protected readonly isSelected: Signal<boolean> = computed(() => this.selectedKey() === this.key());
  protected readonly label: Signal<string> = computed(() => this.node().name);
  protected readonly icon: Signal<string> = computed(() => (this.node().kind === 'project' ? 'fa-light fa-diagram-project' : 'fa-light fa-people-group'));

  protected toggleExpand(event: Event): void {
    event.stopPropagation();
    if (this.expanded()) {
      this.expanded.set(false);
      return;
    }
    this.expanded.set(true);
    // Retry on a failed load, not on a confirmed-empty one — a real leaf (successfully loaded,
    // zero children) must not refetch on every re-expand the way a transient failure should.
    if (!this.childrenLoaded() || this.loadFailed()) {
      this.loadChildren();
    }
  }

  protected select(): void {
    this.nodeSelected.emit(this.node());
  }

  protected onChildSelected(node: CreatePickerNode): void {
    this.nodeSelected.emit(node);
  }

  private loadChildren(): void {
    this.loadingChildren.set(true);
    this.loadFailed.set(false);
    this.childrenSubscription?.unsubscribe();
    const target = this.node();
    this.childrenSubscription = this.pickerService
      .getChildren(target.kind, target.uid, this.artifactType())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.children.set([...result.projects, ...result.committees]);
          this.loadingChildren.set(false);
          this.childrenLoaded.set(true);
        },
        error: (error) => {
          console.error('Failed to load create-picker children:', error);
          this.loadingChildren.set(false);
          this.loadFailed.set(true);
        },
      });
  }
}
