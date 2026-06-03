// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { CAMPAIGN_PACING_THRESHOLDS, parseCampaignName } from '@lfx-one/shared/constants';
import type { CampaignActionItem, CampaignMetrics } from '@lfx-one/shared/interfaces';

@Pipe({ name: 'priorityClass' })
export class PriorityClassPipe implements PipeTransform {
  public transform(priority: CampaignActionItem['priority']): string {
    switch (priority) {
      case 'HIGH':
        return 'bg-red-100 text-red-700';
      case 'MED':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }
}

@Pipe({ name: 'qualityScoreClass' })
export class QualityScoreClassPipe implements PipeTransform {
  public transform(score: number | null): string {
    if (score === null) return 'text-gray-400';
    if (score >= 7) return 'text-green-700';
    if (score >= 4) return 'text-amber-700';
    return 'text-red-700';
  }
}

@Pipe({ name: 'pacingClass' })
export class PacingClassPipe implements PipeTransform {
  public transform(campaign: CampaignMetrics): string {
    const pct = campaign.pacingPct;
    if (pct < CAMPAIGN_PACING_THRESHOLDS.underspending) return 'bg-red-500';
    if (pct <= CAMPAIGN_PACING_THRESHOLDS.normal) return 'bg-green-500';
    if (pct <= CAMPAIGN_PACING_THRESHOLDS.constrained) return 'bg-amber-500';
    return 'bg-red-500';
  }
}

@Pipe({ name: 'eventLabel' })
export class EventLabelPipe implements PipeTransform {
  public transform(campaignName: string): string {
    return parseCampaignName(campaignName).baseName || campaignName;
  }
}

@Pipe({ name: 'adsCurrency' })
export class AdsCurrencyPipe implements PipeTransform {
  public transform(value: number): string {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

@Pipe({ name: 'adsPct' })
export class AdsPctPipe implements PipeTransform {
  public transform(value: number): string {
    return `${value.toFixed(2)}%`;
  }
}
