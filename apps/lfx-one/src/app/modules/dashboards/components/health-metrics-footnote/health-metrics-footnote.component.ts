// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HEALTH_METRICS_BASE_PATH, HEALTH_METRICS_NOTE_STYLES } from '@lfx-one/shared/constants';
import { UiNoteComponent } from '@shared/uikit/note/note.component';

import type { HealthMetricsFootnotePart, HealthMetricsNoteStyle, HealthMetricsNoteTone } from '@lfx-one/shared/interfaces';

/**
 * A Health Metrics note: a small `lfx-ui-note`, warning for a caution, or a verdict with its label. Text comes as parts so a
 * run can be bold or link to another tab; projected content follows the parts.
 */
@Component({
  selector: 'lfx-health-metrics-footnote',
  imports: [RouterLink, UiNoteComponent],
  templateUrl: './health-metrics-footnote.component.html',
  host: { class: 'block' },
})
export class HealthMetricsFootnoteComponent {
  public readonly parts = input<readonly HealthMetricsFootnotePart[]>([]);
  public readonly tone = input.required<HealthMetricsNoteTone>();

  protected readonly basePath = HEALTH_METRICS_BASE_PATH;
  protected readonly noteStyle: Signal<HealthMetricsNoteStyle> = computed(() => HEALTH_METRICS_NOTE_STYLES[this.tone()]);
}
