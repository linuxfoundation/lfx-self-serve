// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Health Score v2 summary description, ported verbatim from LFX Insights
 * (`frontend/config/health-breakdown-templates.ts`, `getHealthScoreDescription` + private helpers):
 * same thresholds, templates, category label maps, and redistribution clause. The single nested
 * ternary in the original is an equivalent if-chain here (repo style: never nest ternaries).
 */

type HealthCategoryKey = 'maintainer' | 'security' | 'development';

const CATEGORY_LABEL: Record<HealthCategoryKey, string> = {
  maintainer: 'maintainer coverage',
  security: 'security posture',
  development: 'development cadence',
};

// Plain-name form for the redistribution clause, distinct from the lowercase CATEGORY_LABEL
// used inline in strength/gap sentences.
const CATEGORY_NAME: Record<HealthCategoryKey, string> = {
  maintainer: 'Maintainer Health',
  security: 'Security & Supply Chain',
  development: 'Development Activity',
};

const capitalize = (value: string): string => (value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value);

const joinWithAnd = (items: string[]): string => {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

const buildRedistributionClause = (availableKeys: HealthCategoryKey[]): string => {
  const allKeys: HealthCategoryKey[] = ['maintainer', 'security', 'development'];
  const unavailable = allKeys.filter((key) => !availableKeys.includes(key));
  if (unavailable.length === 0) return '';
  const names = joinWithAnd(unavailable.map((key) => CATEGORY_NAME[key]));
  const verb = unavailable.length === 1 ? 'is' : 'are';
  return ` ${names} ${verb} unavailable, so weights were redistributed.`;
};

export const getHealthScoreDescription = (
  healthLabel: string | null,
  maintainerScore: number | null,
  securityScore: number | null,
  developmentScore: number | null
): string | null => {
  if (healthLabel === null) {
    return 'No scoring data is available. This project has no indexed repositories or the connected platform has no supported data pipeline.';
  }
  const categoryPercents = (
    [
      { key: 'maintainer', percent: maintainerScore !== null ? maintainerScore / 40 : -1 },
      { key: 'security', percent: securityScore !== null ? securityScore / 35 : -1 },
      { key: 'development', percent: developmentScore !== null ? developmentScore / 25 : -1 },
    ] as { key: HealthCategoryKey; percent: number }[]
  ).filter((c) => c.percent >= 0);

  if (categoryPercents.length === 0) {
    return `Overall project health is ${healthLabel}, based on maintainer activity, security posture, and development cadence.`;
  }

  const availableKeys = categoryPercents.map((c) => c.key);
  const redistributionClause = buildRedistributionClause(availableKeys);

  if (categoryPercents.length === 1) {
    const only = categoryPercents[0] as { key: HealthCategoryKey; percent: number };
    const label = CATEGORY_LABEL[only.key];
    let strengthWord = 'Weak';
    if (only.percent >= 0.7) {
      strengthWord = 'Strong';
    } else if (only.percent >= 0.4) {
      strengthWord = 'Middling';
    }
    return `${strengthWord} ${label} is the only scored signal for this project.${redistributionClause}`;
  }

  const sorted = [...categoryPercents].sort((a, b) => b.percent - a.percent);
  const strongest = sorted[0] as { key: HealthCategoryKey; percent: number };
  const weakest = sorted[sorted.length - 1] as { key: HealthCategoryKey; percent: number };
  const strengthLabels = sorted.slice(0, -1).map((c) => CATEGORY_LABEL[c.key]);
  const strengthsText = joinWithAnd(strengthLabels);
  const gapLabel = CATEGORY_LABEL[weakest.key];

  if (strongest.percent === weakest.percent) {
    const allLabels = joinWithAnd(sorted.map((c) => CATEGORY_LABEL[c.key]));
    if (healthLabel === 'excellent' || healthLabel === 'healthy') {
      return `Consistent ${allLabels} across the board.${redistributionClause || ' No single category stands out as a gap.'}`;
    }
    if (healthLabel === 'fair') {
      return `${capitalize(allLabels)} are all middling, with no clear strength to lean on.${redistributionClause}`;
    }
    return `${capitalize(allLabels)} are all weak, with no clear strength to offset the risk.${redistributionClause}`;
  }

  const strengthVerbHelp = strengthLabels.length === 1 ? 'helps' : 'help';
  const strengthVerbBe = strengthLabels.length === 1 ? 'is' : 'are';
  const strengthVerbShow = strengthLabels.length === 1 ? 'shows' : 'show';

  let sentence1: string;
  let sentence2: string;

  switch (healthLabel) {
    case 'excellent':
      sentence1 = `Strong ${strengthsText}.`;
      sentence2 = `${capitalize(gapLabel)} is the only remaining gap.`;
      break;
    case 'healthy':
      sentence1 = `Solid ${strengthsText}.`;
      sentence2 = `${capitalize(gapLabel)} keeps the score from reaching Excellent.`;
      break;
    case 'fair':
      sentence1 = `${capitalize(gapLabel)} drags the score down.`;
      sentence2 = `${capitalize(strengthsText)} ${strengthVerbHelp} keep it from falling further.`;
      break;
    case 'concerning':
      sentence1 = `${capitalize(gapLabel)} is the lead risk.`;
      sentence2 = `${capitalize(strengthsText)} ${strengthVerbBe} present but not enough to offset the structural risk.`;
      break;
    case 'critical':
      sentence1 = `${capitalize(gapLabel)} is the primary crisis signal.`;
      sentence2 = `${capitalize(strengthsText)} ${strengthVerbShow} little to offset it. Every health signal is at or near zero.`;
      break;
    default:
      sentence1 = `Overall project health is ${healthLabel}.`;
      sentence2 = `${capitalize(gapLabel)} is the weakest area.`;
  }

  return `${sentence1} ${sentence2}${redistributionClause}`;
};
