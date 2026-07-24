// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, signal, Signal, WritableSignal } from '@angular/core';
import { CreatableArtifactType, CreatePickerNode } from '@lfx-one/shared/interfaces';
import { CreateTargetPickerService } from '@services/create-target-picker.service';

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

  public readonly node = input.required<CreatePickerNode>();
  public readonly artifactType = input.required<CreatableArtifactType>();
  public readonly depth = input(0);
  public readonly selectedKey = input<string | null>(null);

  public readonly nodeSelected = output<CreatePickerNode>();

  protected readonly expanded: WritableSignal<boolean> = signal(false);
  protected readonly loadingChildren: WritableSignal<boolean> = signal(false);
  protected readonly childrenLoaded: WritableSignal<boolean> = signal(false);
  protected readonly children: WritableSignal<CreatePickerNode[]> = signal<CreatePickerNode[]>([]);

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
    if (!this.childrenLoaded()) {
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
    const target = this.node();
    this.pickerService.getChildren(target.kind, target.uid, this.artifactType()).subscribe((result) => {
      this.children.set([...result.projects, ...result.committees]);
      this.loadingChildren.set(false);
      this.childrenLoaded.set(true);
    });
  }
}
