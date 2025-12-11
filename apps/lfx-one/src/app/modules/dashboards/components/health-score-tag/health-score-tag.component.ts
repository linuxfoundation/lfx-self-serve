// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import { FoundationHealthScore } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-health-score-tag',
  imports: [],
  templateUrl: './health-score-tag.component.html',
  styleUrl: './health-score-tag.component.scss',
})
export class HealthScoreTagComponent {
  /**
   * Health score level
   */
  public score = input.required<FoundationHealthScore>();

  /**
   * Get CSS classes for the health score badge
   */
  protected getScoreClasses(): string {
    const baseClasses = 'px-2 py-1 text-xs font-medium rounded-full border';
    const scoreMap: Record<FoundationHealthScore, string> = {
      excellent: 'bg-green-100 text-green-800 border-green-300',
      healthy: 'bg-blue-100 text-blue-800 border-blue-300',
      stable: 'bg-gray-100 text-gray-800 border-gray-300',
      unsteady: 'bg-amber-100 text-amber-800 border-amber-300',
      critical: 'bg-red-100 text-red-800 border-red-300',
    };

    return `${baseClasses} ${scoreMap[this.score()]}`;
  }

  /**
   * Get display label for the health score
   */
  protected getScoreLabel(): string {
    return this.score().charAt(0).toUpperCase() + this.score().slice(1);
  }
}
