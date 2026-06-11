// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OsspreyHealthBand, OsspreyLifecycle, OsspreyStatus, OspreySeverity, TagSeverity } from '@lfx-one/shared/interfaces';

export function getStatusTagSeverity(status: OsspreyStatus): TagSeverity {
  const map: Record<OsspreyStatus, TagSeverity> = {
    unassigned: 'secondary',
    open: 'info',
    assessing: 'info',
    active: 'success',
    needs_attention: 'warn',
    escalated: 'danger',
    blocked: 'danger',
    inactive: 'secondary',
  };
  return map[status] ?? 'secondary';
}

export function getLifecycleTagSeverity(lifecycle: OsspreyLifecycle | null): TagSeverity {
  if (!lifecycle) return 'secondary';
  const map: Record<OsspreyLifecycle, TagSeverity> = {
    active: 'success',
    stable: 'info',
    declining: 'warn',
    abandoned: 'danger',
  };
  return map[lifecycle] ?? 'secondary';
}

export function getHealthTagSeverity(score: number | null): TagSeverity {
  if (score === null) return 'secondary';
  if (score >= 70) return 'success';
  if (score >= 50) return 'info';
  if (score >= 30) return 'warn';
  return 'danger';
}

export function getAdvisoryTagSeverity(severity: OspreySeverity | null): TagSeverity {
  if (!severity) return 'secondary';
  const map: Record<OspreySeverity, TagSeverity> = {
    critical: 'danger',
    high: 'danger',
    medium: 'warn',
    low: 'info',
  };
  return map[severity];
}

export function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

// Band thresholds mirror the design spec (design/LFX-OSSPREY-Admin-Dashboard.html):
// healthy ≥70, fair ≥50, concerning ≥30, otherwise critical.
export function getHealthBand(score: number): OsspreyHealthBand {
  if (score >= 70) return 'healthy';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'concerning';
  return 'critical';
}

export function getHealthLabel(score: number): string {
  const band = getHealthBand(score);
  return band.charAt(0).toUpperCase() + band.slice(1);
}

export function getLifecycleLabel(lifecycle: OsspreyLifecycle | null): string {
  if (!lifecycle) return 'Unknown';
  return lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1);
}
