// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, Signal, signal, WritableSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TableComponent } from '@components/table/table.component';
import { Committee } from '@lfx-pcc/shared/interfaces';
import { CommitteeTypeColorPipe } from '@pipes/committee-type-colors.pipe';
import { ProjectService } from '@services/project.service';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-committee-table',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonComponent, MenuComponent, TableComponent, CommitteeTypeColorPipe],
  templateUrl: './committee-table.component.html',
})
export class CommitteeTableComponent {
  private readonly projectService = inject(ProjectService);

  public readonly committees = input.required<Committee[]>();
  public readonly editCommittee = output<Committee>();
  public readonly deleteCommittee = output<Committee>();
  public readonly viewCommittee = output<Committee>();

  public readonly project = this.projectService.project;

  // Selected committee for menu actions
  public selectedCommittee: WritableSignal<Committee | null> = signal(null);

  // Menu items for committee actions
  public committeeActionMenuItems: MenuItem[] = this.initializeCommitteeActionMenuItems();

  // Organize committees with hierarchy for display
  public readonly organizedCommittees: Signal<(Committee & { level?: number })[]> = computed(() => {
    const allCommittees = this.committees();
    const result: (Committee & { level?: number })[] = [];

    // First, add all parent committees (those without parent_uid)
    const parentCommittees = allCommittees.filter((c) => !c.parent_uid);

    parentCommittees.forEach((parent) => {
      result.push(parent);

      // Then add any subcommittees for this parent
      const subcommittees = allCommittees.filter((c) => c.parent_uid === parent.id);
      subcommittees.forEach((sub) => {
        result.push({ ...sub, level: 1 });
      });
    });

    // Add any orphaned committees (shouldn't happen, but just in case)
    const orphaned = allCommittees.filter((c) => c.parent_uid && !allCommittees.find((p) => p.id === c.parent_uid));
    result.push(...orphaned);

    return result;
  });

  public onEdit(committee: Committee): void {
    this.editCommittee.emit(committee);
  }

  public onDelete(committee: Committee): void {
    this.deleteCommittee.emit(committee);
  }

  public onView(committee: Committee): void {
    this.viewCommittee.emit(committee);
  }

  public toggleCommitteeActionMenu(event: Event, committee: Committee, menuComponent: MenuComponent): void {
    event.stopPropagation();
    this.selectedCommittee.set(committee);
    menuComponent.toggle(event);
  }

  private initializeCommitteeActionMenuItems(): MenuItem[] {
    return [
      {
        label: 'View',
        icon: 'fa-light fa-eye',
        command: () => {
          const committee = this.selectedCommittee();
          if (committee) {
            this.onView(committee);
          }
        },
      },
      {
        separator: true,
      },
      {
        label: 'Delete',
        icon: 'fa-light fa-trash',
        styleClass: 'text-red-500',
        command: () => {
          const committee = this.selectedCommittee();
          if (committee) {
            this.onDelete(committee);
          }
        },
      },
    ];
  }
}
