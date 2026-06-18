// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AkritesHealthBand, AkritesLifecycle, AkritesStatus, AkritesSeverity, TagSeverity } from '@lfx-one/shared/interfaces';

export function getStatusTagSeverity(status: AkritesStatus): TagSeverity {
  const map: Record<AkritesStatus, TagSeverity> = {
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

export function getLifecycleTagSeverity(lifecycle: AkritesLifecycle | null): TagSeverity {
  if (!lifecycle) return 'secondary';
  const map: Record<AkritesLifecycle, TagSeverity> = {
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

export function getAdvisoryTagSeverity(severity: AkritesSeverity | null): TagSeverity {
  if (!severity) return 'secondary';
  const map: Record<AkritesSeverity, TagSeverity> = {
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

// Band thresholds mirror the design spec (design/LFX-AKRITES-Admin-Dashboard.html):
// healthy ≥70, fair ≥50, concerning ≥30, otherwise critical.
function getHealthBand(score: number): AkritesHealthBand {
  if (score >= 70) return 'healthy';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'concerning';
  return 'critical';
}

export function getHealthLabel(score: number): string {
  const band = getHealthBand(score);
  return band.charAt(0).toUpperCase() + band.slice(1);
}

export function getLifecycleLabel(lifecycle: AkritesLifecycle | null): string {
  if (!lifecycle) return 'Unknown';
  return lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1);
}

export function formatActivityType(type: string): string {
  const labels: Record<string, string> = {
    escalation: 'Escalated',
    state_changed: 'Status changed',
    steward_assigned: 'Steward assigned',
    steward_removed: 'Steward removed',
    stewardship_opened: 'Opened for stewardship',
    package_synced: 'Package synced',
    advisory_detected: 'New security advisory detected',
    advisory_resolved: 'Security advisory resolved',
    status_inactive: 'Marked inactive',
    quarterly_update: 'Quarterly status update',
    remediation_logged: 'Remediation progress logged',
    assessment_started: 'Security assessment started',
    blocker_resolved: 'Blocker resolved',
    reactivated: 'Reactivated',
  };
  return labels[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
