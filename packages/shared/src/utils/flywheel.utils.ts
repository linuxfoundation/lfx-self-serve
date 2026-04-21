// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  FlywheelCardSummaryView,
  FlywheelConversionResponse,
  FlywheelHealthMetricsBannerView,
  FlywheelHealthMetricsFunnelStage,
  MarketingKeyInsight,
  MarketingRecommendedAction,
} from '../interfaces';
import { formatNumber } from './number.utils';
import { splitByPriority } from './marketing.utils';

/**
 * Seven re-engagement funnel stages in the required display order for the
 * shared Flywheel Health Metrics funnel helpers defined in this module.
 */
export const FLYWHEEL_FUNNEL_STAGE_LABELS = [
  'Event Attendees',
  'Re-engaged to Community',
  'Re-engaged to WG',
  'Re-engaged to Newsletter',
  'Re-engaged to Training',
  'Re-engaged to Code',
  'Re-engaged to Web',
] as const;

/** Zero-filled fallback used when `data` is null/undefined. */
const DEFAULT_REENGAGEMENT: NonNullable<FlywheelConversionResponse['reengagement']> = {
  totalReengaged: 0,
  reengagementRate: 0,
  reengagementMomChange: 0,
  reengagedToNewsletter: 0,
  reengagedToCommunity: 0,
  reengagedToWorkingGroup: 0,
  reengagedToTraining: 0,
  reengagedToCode: 0,
  reengagedToWeb: 0,
};

/**
 * Returns the `reengagement` block from the response, or a zero-filled fallback
 * when `data` itself is null/undefined. Single source to avoid drift between drawer and card.
 */
export function getFlywheelReengagement(data: FlywheelConversionResponse | null | undefined): NonNullable<FlywheelConversionResponse['reengagement']> {
  return data?.reengagement ?? DEFAULT_REENGAGEMENT;
}

/**
 * Builds the Health Metrics card summary row from the reused flywheel payload.
 * Returns null when no payload is available so the card can render its no-data state.
 */
export function buildFlywheelCardSummary(data: FlywheelConversionResponse | null | undefined): FlywheelCardSummaryView | null {
  if (!data) return null;
  const currentConversionRate = data.conversionRate ?? 0;
  const changePercentage = data.changePercentage ?? 0;
  return {
    currentConversionRate,
    previousPeriodConversionRate: currentConversionRate - changePercentage,
    changePercentage,
    trend: data.trend ?? 'up',
  };
}

/**
 * Builds the Health Metrics card funnel stages in the fixed re-engagement order.
 * Width percentages are relative to `funnel.eventAttendees` and clamped to [0, 100],
 * while zero attendees render empty bars.
 */
export function buildFlywheelFunnelStages(data: FlywheelConversionResponse | null | undefined): FlywheelHealthMetricsFunnelStage[] {
  if (!data) return [];

  const reengagement = getFlywheelReengagement(data);
  const attendees = data.funnel?.eventAttendees ?? 0;

  const counts: number[] = [
    attendees,
    reengagement.reengagedToCommunity ?? 0,
    reengagement.reengagedToWorkingGroup ?? 0,
    reengagement.reengagedToNewsletter ?? 0,
    reengagement.reengagedToTraining ?? 0,
    reengagement.reengagedToCode ?? 0,
    reengagement.reengagedToWeb ?? 0,
  ];

  return FLYWHEEL_FUNNEL_STAGE_LABELS.map((label, i) => {
    const count = counts[i];
    if (attendees <= 0) {
      return { label, count, widthPct: 0 };
    }
    const pct = (count / attendees) * 100;
    const clamped = Math.max(0, Math.min(100, pct));
    return { label, count, widthPct: clamped };
  });
}

/**
 * Returns the reused flywheel recommended actions. Same rule engine as the existing
 * drawer — extracted verbatim so the drawer and card cannot drift in message content.
 */
export function buildFlywheelRecommendedActions(data: FlywheelConversionResponse | null | undefined): MarketingRecommendedAction[] {
  if (!data) return [];

  const { conversionRate, funnel, monthlyData } = data;
  const reengagement = getFlywheelReengagement(data);
  const attendees = funnel?.eventAttendees ?? 0;

  const actions: MarketingRecommendedAction[] = [];

  if ((conversionRate ?? 0) === 0 && attendees === 0 && (monthlyData?.length ?? 0) === 0) {
    return actions;
  }

  if (attendees > 0 && reengagement.reengagedToWorkingGroup > 0 && reengagement.reengagedToCommunity > 0) {
    const wgRate = (reengagement.reengagedToWorkingGroup / attendees) * 100;
    const communityRate = (reengagement.reengagedToCommunity / attendees) * 100;
    if (wgRate < communityRate * 0.5) {
      actions.push({
        title: 'Improve working group re-engagement path',
        description: `WG re-engagement at ${wgRate.toFixed(1)}% vs ${communityRate.toFixed(1)}% for community — attendees need clearer path to participate`,
        priority: 'high',
        dueLabel: 'This quarter',
        actionType: 'conversion',
      });
    }
  }

  if (reengagement.reengagementMomChange < -5) {
    actions.push({
      title: 'Address re-engagement rate decline',
      description: `Re-engagement dropped ${Math.abs(reengagement.reengagementMomChange).toFixed(1)}% MoM — review post-event follow-up effectiveness`,
      priority: 'high',
      dueLabel: 'This month',
      actionType: 'decline',
    });
  }

  if (reengagement.reengagementRate > 0 && reengagement.reengagementRate < 10 && attendees > 0) {
    actions.push({
      title: 'Add post-event engagement CTAs',
      description: `Only ${reengagement.reengagementRate.toFixed(1)}% re-engagement — add community join and working group prompts to event follow-ups`,
      priority: 'medium',
      dueLabel: 'Next event',
      actionType: 'content',
    });
  }

  if (actions.length === 0) {
    const growthSuffix = reengagement.reengagementMomChange > 0 ? ` — improving ${reengagement.reengagementMomChange.toFixed(1)}%` : '';
    actions.push({
      title: 'Continue flywheel optimization',
      description: `${reengagement.reengagementRate.toFixed(1)}% re-engagement rate${growthSuffix} across ${formatNumber(attendees)} attendees`,
      priority: 'low',
      dueLabel: 'Ongoing',
      actionType: 'growth',
    });
  }

  return actions;
}

/**
 * Returns the reused flywheel key insights. Same rule engine as the existing drawer.
 */
export function buildFlywheelKeyInsights(data: FlywheelConversionResponse | null | undefined): MarketingKeyInsight[] {
  if (!data) return [];

  const { conversionRate, funnel, monthlyData } = data;
  const reengagement = getFlywheelReengagement(data);
  const attendees = funnel?.eventAttendees ?? 0;
  const insights: MarketingKeyInsight[] = [];

  if ((conversionRate ?? 0) === 0 && attendees === 0 && (monthlyData?.length ?? 0) === 0) {
    return insights;
  }

  if (attendees > 0) {
    const paths = [
      { name: 'Community', value: reengagement.reengagedToCommunity },
      { name: 'Working group', value: reengagement.reengagedToWorkingGroup },
      { name: 'Newsletter', value: reengagement.reengagedToNewsletter },
      { name: 'Training', value: reengagement.reengagedToTraining },
      { name: 'Code', value: reengagement.reengagedToCode },
      { name: 'Web', value: reengagement.reengagedToWeb },
    ]
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);

    if (paths.length > 0) {
      const bestRate = (paths[0].value / attendees) * 100;
      insights.push({ text: `${paths[0].name} is the highest re-engagement path at ${bestRate.toFixed(1)}% of attendees`, type: 'driver' });
    }

    if (paths.length > 1) {
      const worstRate = (paths[paths.length - 1].value / attendees) * 100;
      insights.push({ text: `${paths[paths.length - 1].name} re-engagement lowest at ${worstRate.toFixed(1)}%`, type: 'warning' });
    }
  }

  if (reengagement.reengagementMomChange > 3) {
    insights.push({ text: `Re-engagement rate trending up ${reengagement.reengagementMomChange.toFixed(1)}% — flywheel is accelerating`, type: 'driver' });
  } else if (reengagement.reengagementMomChange < -3) {
    insights.push({
      text: `Re-engagement rate dropped ${Math.abs(reengagement.reengagementMomChange).toFixed(1)}% — flywheel is slowing`,
      type: 'warning',
    });
  }

  if (monthlyData && monthlyData.length >= 3) {
    const recent3 = monthlyData.slice(-3);
    const isGrowing = recent3[0].value < recent3[1].value && recent3[1].value < recent3[2].value;
    const isShrinking = recent3[0].value > recent3[1].value && recent3[1].value > recent3[2].value;
    if (isGrowing) {
      insights.push({ text: `Re-engaged members growing for 3 consecutive months — ${formatNumber(recent3[2].value)} this month`, type: 'driver' });
    } else if (isShrinking) {
      insights.push({ text: `Re-engaged members declining for 3 consecutive months — ${formatNumber(recent3[2].value)} this month`, type: 'warning' });
    }
  }

  return insights;
}

/**
 * Picks the single prioritized banner message for the Health Metrics card.
 *
 * Selection order (first match wins):
 *   1. Attention action with `priority === 'high'`
 *   2. Attention action with `priority === 'medium'`
 *   3. Attention insight (type === 'warning')
 *   4. Performing action (any — only 'low' end up here)
 *   5. Performing insight (driver/info)
 *
 * Returns `null` when no relevant message is available so the card can hide the banner.
 */
export function selectFlywheelBannerView(data: FlywheelConversionResponse | null | undefined): FlywheelHealthMetricsBannerView | null {
  if (!data) return null;

  const actions = buildFlywheelRecommendedActions(data);
  const insights = buildFlywheelKeyInsights(data);
  const split = splitByPriority(actions, insights);

  const highAction = split.attentionActions.find((a) => a.priority === 'high');
  if (highAction) {
    return { text: highAction.description || highAction.title, sourceType: 'action', priorityGroup: 'attention' };
  }

  const mediumAction = split.attentionActions.find((a) => a.priority === 'medium');
  if (mediumAction) {
    return { text: mediumAction.description || mediumAction.title, sourceType: 'action', priorityGroup: 'attention' };
  }

  const attentionInsight = split.attentionInsights[0];
  if (attentionInsight) {
    return { text: attentionInsight.text, sourceType: 'insight', priorityGroup: 'attention' };
  }

  const performingAction = split.performingActions[0];
  if (performingAction) {
    return { text: performingAction.description || performingAction.title, sourceType: 'action', priorityGroup: 'performing' };
  }

  const performingInsight = split.performingInsights[0];
  if (performingInsight) {
    return { text: performingInsight.text, sourceType: 'insight', priorityGroup: 'performing' };
  }

  return null;
}
