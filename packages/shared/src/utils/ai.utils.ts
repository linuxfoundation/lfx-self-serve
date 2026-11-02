// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AI_REQUEST_CONFIG, AI_SAMPLING_COMPATIBILITY } from '../constants/ai.constants';
import type { AiSamplingCompatibilityRule, AiSamplingMode, AiSamplingParams } from '../interfaces/ai.interface';

/**
 * The `AI_SAMPLING_COMPATIBILITY` row a model name matches, or `undefined` for a name the table
 * does not know — which callers treat as `none`.
 */
export function findAiSamplingRule(model: string): AiSamplingCompatibilityRule | undefined {
  return AI_SAMPLING_COMPATIBILITY.find((rule) => rule.pattern.test(model));
}

/**
 * Which sampling parameters `model` accepts. Unknown and newer models resolve to `none`.
 */
export function resolveAiSamplingMode(model: string): AiSamplingMode {
  return findAiSamplingRule(model)?.mode ?? 'none';
}

/**
 * The sampling fields to spread into a chat request body for `model` — `{ temperature }` for a
 * family known to accept it, otherwise an empty object, so the field is absent from the JSON rather
 * than sent as `null`.
 */
export function getAiSamplingParams(model: string): AiSamplingParams {
  return resolveAiSamplingMode(model) === 'temperature' ? { temperature: AI_REQUEST_CONFIG.TEMPERATURE } : {};
}
