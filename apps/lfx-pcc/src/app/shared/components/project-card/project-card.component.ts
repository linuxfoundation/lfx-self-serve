// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ProjectCardMetric } from '@lfx-pcc/shared/interfaces';
import { BadgeModule } from 'primeng/badge';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'lfx-project-card',
  standalone: true,
  imports: [CommonModule, RouterModule, CardModule, BadgeModule],
  templateUrl: './project-card.component.html',
  styleUrl: './project-card.component.scss',
})
export class ProjectCardComponent {
  public readonly name = input.required<string | undefined>();
  public readonly description = input.required<string | undefined>();
  public readonly logo = input.required<string | undefined>();
  public readonly metrics = input<ProjectCardMetric[]>([]);
  public readonly url = input<string | undefined>('');
}
