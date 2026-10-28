// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AI_MODEL, AI_REQUEST_CONFIG } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// The helper memoizes the model for the life of the process, so each case loads a fresh copy of
// it (and of the mocked logger it reports through) after `vi.resetModules()`.
async function loadHelper() {
  const helper = await import('./ai-model.helper');
  const { logger } = await import('../services/logger.service');
  return { ...helper, logger };
}

describe('getAiModel', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads the AI_MODEL env var when set', async () => {
    process.env['AI_MODEL'] = 'claude-opus-4-6';
    const { getAiModel } = await loadHelper();
    expect(getAiModel()).toBe('claude-opus-4-6');
  });

  it('falls back to the AI_MODEL constant when the env var is unset', async () => {
    delete process.env['AI_MODEL'];
    const { getAiModel } = await loadHelper();
    expect(getAiModel()).toBe(AI_MODEL);
  });

  it('falls back to the AI_MODEL constant when the env var is empty', async () => {
    process.env['AI_MODEL'] = '';
    const { getAiModel } = await loadHelper();
    expect(getAiModel()).toBe(AI_MODEL);
  });

  it('treats a whitespace-only value as empty and trims a padded one', async () => {
    process.env['AI_MODEL'] = '   ';
    expect((await loadHelper()).getAiModel()).toBe(AI_MODEL);

    vi.resetModules();
    process.env['AI_MODEL'] = ' claude-sonnet-4-6\n';
    expect((await loadHelper()).getAiModel()).toBe('claude-sonnet-4-6');
  });

  it('memoizes the first read, since env is stable after startup', async () => {
    process.env['AI_MODEL'] = 'claude-sonnet-4-6';
    const { getAiModel } = await loadHelper();
    expect(getAiModel()).toBe('claude-sonnet-4-6');
    process.env['AI_MODEL'] = 'claude-opus-4-8';
    expect(getAiModel()).toBe('claude-sonnet-4-6');
  });
});

describe('getAiSamplingParams', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sends temperature for the configured model when its family accepts it', async () => {
    process.env['AI_MODEL'] = 'claude-sonnet-4-6';
    expect((await loadHelper()).getAiSamplingParams()).toEqual({ temperature: AI_REQUEST_CONFIG.TEMPERATURE });
  });

  it('sends nothing for the configured model when its family rejects it', async () => {
    process.env['AI_MODEL'] = 'claude-opus-4-8';
    expect((await loadHelper()).getAiSamplingParams()).toEqual({});
  });
});

describe('logAiModelConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('logs the model, where it came from and its sampling mode — and no secret', async () => {
    process.env['AI_MODEL'] = 'claude-sonnet-5-5';
    process.env['AI_API_KEY'] = 'sk-secret-should-never-be-logged';
    process.env['AI_PROXY_URL'] = 'https://user:pass@proxy.example.test/chat/completions';
    const { logAiModelConfig, logger } = await loadHelper();

    logAiModelConfig();

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(undefined, 'ai_model_config', 'AI model configured', {
      model: 'claude-sonnet-5-5',
      source: 'env',
      sampling_mode: 'none',
      sampling_family: 'Claude 5-series and later',
    });
    const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logged).not.toContain('sk-secret');
    expect(logged).not.toContain('user:pass');
    expect(logger.warning).not.toHaveBeenCalled();
  });

  it('reports the default source and an unknown family for an unrecognised name', async () => {
    delete process.env['AI_MODEL'];
    const first = await loadHelper();
    first.logAiModelConfig();
    expect(vi.mocked(first.logger.info).mock.calls[0][3]).toMatchObject({ model: AI_MODEL, source: 'default', sampling_mode: 'temperature' });

    vi.resetModules();
    vi.clearAllMocks();
    process.env['AI_MODEL'] = 'some-future-model';
    const second = await loadHelper();
    second.logAiModelConfig();
    expect(vi.mocked(second.logger.info).mock.calls[0][3]).toMatchObject({ sampling_mode: 'none', sampling_family: 'unknown' });
  });

  it('reports model and source from the same memoized read, even if env changes afterwards', async () => {
    delete process.env['AI_MODEL'];
    const { getAiModel, logAiModelConfig, logger } = await loadHelper();
    expect(getAiModel()).toBe(AI_MODEL);

    process.env['AI_MODEL'] = 'claude-opus-4-6';
    logAiModelConfig();

    expect(vi.mocked(logger.info).mock.calls[0][3]).toMatchObject({ model: AI_MODEL, source: 'default' });
  });

  it('warns when the configured name is a Bedrock routing id rather than a published short name', async () => {
    process.env['AI_MODEL'] = 'bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0';
    const { logAiModelConfig, logger } = await loadHelper();

    logAiModelConfig();

    expect(logger.warning).toHaveBeenCalledTimes(1);
  });
});

// The chart default is what every environment sends unless argocd overrides it, so it has to equal
// the code default — otherwise shipping the key would itself be a model swap.
describe('chart default', () => {
  it('sets environment.AI_MODEL to the AI_MODEL constant', () => {
    const valuesPath = fileURLToPath(new URL('../../../../../charts/lfx-self-serve/values.yaml', import.meta.url));
    const values = readFileSync(valuesPath, 'utf8');
    const match = values.match(/^ {2}AI_MODEL:\n {4}value: "([^"]*)"$/m);

    expect(match?.[1]).toBe(AI_MODEL);
  });
});
