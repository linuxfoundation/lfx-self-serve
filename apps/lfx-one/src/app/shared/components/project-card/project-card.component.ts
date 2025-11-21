// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TagComponent } from '@components/tag/tag.component';
import { ComponentSeverity, ProjectCardMetric } from '@lfx-one/shared';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'lfx-project-card',
  standalone: true,
  imports: [CommonModule, RouterModule, CardModule, TagComponent],
  templateUrl: './project-card.component.html',
  styleUrl: './project-card.component.scss',
})
export class ProjectCardComponent {
  public readonly name = input.required<string | undefined>();
  public readonly description = input.required<string | undefined>();
  public readonly logo = input.required<string | undefined>();
  public readonly metrics = input<ProjectCardMetric[]>([]);
  public readonly url = input<string | undefined>('');

  // Map 'warning' to 'warn' for PrimeNG tag compatibility
  public mapSeverity(severity: string): ComponentSeverity {
    return severity === 'warning' ? 'warn' : (severity as ComponentSeverity);
  }
}
