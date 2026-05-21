// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FundType } from '../enums/crowdfunding.enum';

export const CROWDFUNDING_FUND_TYPE_LABELS: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'General Fund',
  [FundType.SECURITY_AUDIT]: 'Security Audit',
  [FundType.MENTORSHIP]: 'Mentorship',
  [FundType.EVENT]: 'Event',
};

export const CROWDFUNDING_FUND_TYPE_ICONS: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'fa-light fa-piggy-bank',
  [FundType.SECURITY_AUDIT]: 'fa-light fa-shield-halved',
  [FundType.MENTORSHIP]: 'fa-light fa-user-group',
  [FundType.EVENT]: 'fa-light fa-calendar',
};

export const CROWDFUNDING_FUND_TYPE_COLOR_CLASSES: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'text-violet-600',
  [FundType.SECURITY_AUDIT]: 'text-amber-600',
  [FundType.MENTORSHIP]: 'text-emerald-600',
  [FundType.EVENT]: 'text-blue-600',
};

export const CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'rounded-xl bg-violet-100 !text-violet-700',
  [FundType.SECURITY_AUDIT]: 'rounded-xl bg-amber-100 !text-amber-700',
  [FundType.MENTORSHIP]: 'rounded-xl bg-emerald-100 !text-emerald-700',
  [FundType.EVENT]: 'rounded-xl bg-blue-100 !text-blue-700',
};

export const CROWDFUNDING_DONOR_AVATAR_PALETTE: string[] = [
  'bg-blue-100 !text-blue-700',
  'bg-violet-100 !text-violet-700',
  'bg-emerald-100 !text-emerald-700',
  'bg-amber-100 !text-amber-700',
];
