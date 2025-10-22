// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, ViewChild } from '@angular/core';
import { PersonaService } from '@app/shared/services/persona.service';
import { ChartComponent } from '@components/chart/chart.component';
import { CORE_DEVELOPER_PROGRESS_METRICS, MAINTAINER_PROGRESS_METRICS } from '@lfx-one/shared/constants';

import type { ProgressItemWithChart } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-recent-progress',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  templateUrl: './recent-progress.component.html',
  styleUrl: './recent-progress.component.scss',
})
export class RecentProgressComponent {
  @ViewChild('progressScroll') protected progressScrollContainer!: ElementRef;

  private readonly personaService = inject(PersonaService);

  /**
   * Computed signal that returns progress metrics based on the current persona
   */
  protected readonly progressItems = computed<ProgressItemWithChart[]>(() => {
    const persona = this.personaService.currentPersona();

    switch (persona) {
      case 'maintainer':
        return MAINTAINER_PROGRESS_METRICS;
      case 'core-developer':
      default:
        return CORE_DEVELOPER_PROGRESS_METRICS;
    }
  });

  protected scrollLeft(): void {
    const container = this.progressScrollContainer.nativeElement;
    container.scrollBy({ left: -300, behavior: 'smooth' });
  }

  protected scrollRight(): void {
    const container = this.progressScrollContainer.nativeElement;
    container.scrollBy({ left: 300, behavior: 'smooth' });
  }
}
