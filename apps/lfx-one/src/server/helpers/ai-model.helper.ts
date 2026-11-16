// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AI_MODEL, AI_PUBLISHED_MODEL_NAME_PATTERN } from '@lfx-one/shared/constants';
import type { AiSamplingParams } from '@lfx-one/shared/interfaces';
// Deep import, not the `utils` barrel: specs that mock the barrel to a single helper
// (`ai.service.spec.ts`) would otherwise see the guard as undefined.
import { findAiSamplingRule, getAiSamplingParams as samplingParamsFor } from '@lfx-one/shared/utils/ai.utils';

import { logger } from '../services/logger.service';

// The model the two services that POST to the LiteLLM proxy send — `ai.service.ts` and
// `campaign-proxy.service.ts` — read from one place so the two cannot disagree.

// Resolved lazily on first access so process.loadEnvFile has finished loading,
// then memoized — env is stable after startup. The source is memoized with the model so the
// startup log reports both from the same read.
let resolvedModel: { model: string; source: 'env' | 'default' } | undefined;

function resolveAiModel(): { model: string; source: 'env' | 'default' } {
  if (!resolvedModel) {
    // Trimmed, because a stray newline from a values file would otherwise be sent as part of the
    // name and answered with the proxy's unhelpful `429`.
    const fromEnv = process.env['AI_MODEL']?.trim();
    resolvedModel = fromEnv ? { model: fromEnv, source: 'env' } : { model: AI_MODEL, source: 'default' };
  }
  return resolvedModel;
}

/**
 * The model named by the `AI_MODEL` env var, or the `AI_MODEL` constant when the var is unset,
 * empty or whitespace.
 */
export function getAiModel(): string {
  return resolveAiModel().model;
}

/**
 * The sampling fields to spread into a request body for the configured model — see
 * `AI_SAMPLING_COMPATIBILITY`. Empty for any model the table does not know.
 */
export function getAiSamplingParams(): AiSamplingParams {
  return samplingParamsFor(getAiModel());
}

/**
 * One INFO line at startup naming the model and the sampling mode it resolved to, so a swap made in
 * argocd is visible in the pod's logs without a request having to fail first. Logs the model name
 * only — never `AI_API_KEY`, and not `AI_PROXY_URL` either, since a URL can carry credentials.
 */
export function logAiModelConfig(): void {
  const { model, source } = resolveAiModel();
  const rule = findAiSamplingRule(model);
  const metadata = {
    model,
    source,
    sampling_mode: rule?.mode ?? 'none',
    sampling_family: rule?.family ?? 'unknown',
  };

  logger.info(undefined, 'ai_model_config', 'AI model configured', metadata);

  if (!AI_PUBLISHED_MODEL_NAME_PATTERN.test(model)) {
    logger.warning(undefined, 'ai_model_config', 'AI_MODEL does not look like a published LiteLLM short name; the proxy will likely answer 429', metadata);
  }
}
