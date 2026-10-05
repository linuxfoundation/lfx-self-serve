// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BOARD_SCOPED_PERSONAS, DETECTION_SOURCE_LABEL_FALLBACK, DETECTION_SOURCE_LABELS, PROJECT_SCOPED_PERSONAS } from '../constants/persona.constants';
import type { PersonaDetection } from '../interfaces/persona-detection.interface';
import type { PersonaType } from '../interfaces/persona.interface';

export function isBoardScopedPersona(persona: PersonaType): boolean {
  return BOARD_SCOPED_PERSONAS.has(persona);
}

export function isProjectScopedPersona(persona: PersonaType): boolean {
  return PROJECT_SCOPED_PERSONAS.has(persona);
}

/** Deduped, human-readable labels for a project's detections. `Object.hasOwn` guards against inherited `Object.prototype` keys (e.g. `constructor`) resolving as a false hit. */
export function getDetectionLabels(detections: PersonaDetection[]): string[] {
  const labels = detections.map((d) => (Object.hasOwn(DETECTION_SOURCE_LABELS, d.source) ? DETECTION_SOURCE_LABELS[d.source] : DETECTION_SOURCE_LABEL_FALLBACK));
  return Array.from(new Set(labels));
}

/** Tooltip HTML for the dashboard role badge. Lists every detected source — not only the ones that determined the displayed role label. */
export function buildRoleTooltip(labels: string[]): string {
  if (labels.length === 0) return 'No specific activity detected';
  if (labels.length === 1) return labels[0];
  return `All detected activity:<ul class="flex list-disc flex-col gap-1 pl-4 text-left">${labels.map((label) => `<li>${label}</li>`).join('')}</ul>`;
}

/** Plain-text description of a role badge's detections, for `aria-label` — screen readers can't read the `pTooltip` HTML content. */
export function buildRoleAriaLabel(role: string, labels: string[]): string {
  if (labels.length === 0) return `Role: ${role}`;
  return `Role: ${role}. Detected activity: ${labels.join(', ')}.`;
}
