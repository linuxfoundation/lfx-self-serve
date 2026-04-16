// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MarketingKeyInsight, MarketingRecommendedAction, MarketingSplitByPriority } from '../interfaces/analytics-data.interface';

export type { MarketingSplitByPriority };

export function splitByPriority(actions: MarketingRecommendedAction[], insights: MarketingKeyInsight[]): MarketingSplitByPriority {
  return {
    attentionActions: actions.filter((a) => a.priority === 'high' || a.priority === 'medium'),
    attentionInsights: insights.filter((i) => i.type === 'warning'),
    performingActions: actions.filter((a) => a.priority === 'low'),
    performingInsights: insights.filter((i) => i.type === 'driver' || i.type === 'info'),
  };
}
