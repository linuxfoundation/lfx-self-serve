// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { CommitteeTypeColorPipe } from '@app/shared/pipes/committee-type-colors.pipe';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { Committee } from '@lfx-one/shared/interfaces';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-committee-table',
  standalone: true,
  imports: [CommonModule, CardComponent, ButtonComponent, TooltipModule, CommitteeTypeColorPipe],
  templateUrl: './committee-table.component.html',
  styleUrl: './committee-table.component.scss',
})
export class CommitteeTableComponent {
  // Inputs
  public committees = input.required<Committee[]>();
  public canManageCommittee = input<boolean>(false);
  public committeeLabel = input<string>('Committee');
  public isDeleting = input<boolean>(false);

  // Outputs
  public readonly viewCommittee = output<Committee>();
  public readonly editCommittee = output<Committee>();
  public readonly deleteCommittee = output<Committee>();
  public readonly addMember = output<Committee>();

  // Event handlers
  public onViewCommittee(committee: Committee): void {
    this.viewCommittee.emit(committee);
  }

  public onEditCommittee(committee: Committee): void {
    this.editCommittee.emit(committee);
  }

  public onDeleteCommittee(committee: Committee): void {
    this.deleteCommittee.emit(committee);
  }

  public onAddMember(committee: Committee): void {
    this.addMember.emit(committee);
  }
}
