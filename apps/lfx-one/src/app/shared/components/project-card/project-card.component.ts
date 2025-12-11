// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TagComponent } from '@components/tag/tag.component';
import { ProjectCardMetric, TagSeverity } from '@lfx-one/shared';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'lfx-project-card',
  imports: [RouterModule, CardModule, TagComponent],
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
  public mapSeverity(severity: string): TagSeverity {
    return severity === 'warning' ? 'warn' : (severity as TagSeverity);
  }
}
