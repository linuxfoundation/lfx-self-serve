// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { AI_ERROR_DETAIL_LIMIT, AiProxyError, aiErrorSummary, readAiJson } from './ai-error.helper';

/** A 2xx Response stand-in whose body is `text`, verbatim. */
function okResponse(text: string, status = 200): Response {
  return { ok: true, status, text: async () => text } as unknown as Response;
}

/** The error `readAiJson` throws for `text`, so each case can inspect both halves of it. */
async function refusal(text: string, apiKey = 'test-key'): Promise<AiProxyError> {
  const error = await readAiJson(okResponse(text), apiKey).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AiProxyError);
  return error as AiProxyError;
}

describe('readAiJson (#4500)', () => {
  it('returns the parsed object for a JSON object body', async () => {
    await expect(readAiJson(okResponse('{"choices":[{"message":{"content":"hi"}}]}'), 'test-key')).resolves.toEqual({
      choices: [{ message: { content: 'hi' } }],
    });
  });

  it('refuses a non-JSON body as a named AiProxyError, not a raw SyntaxError', async () => {
    const error = await refusal('<!DOCTYPE html><html><body>Bad gateway</body></html>');

    expect(error.summary).toBe('AI proxy returned a response that is not a JSON object (200)');
    expect(error.message).toBe('AI proxy returned a response that is not a JSON object (200): <!DOCTYPE html><html><body>Bad gateway</body></html>');
  });

  it('keeps the body out of the summary, which is what a user may be shown', async () => {
    const error = await refusal('<html>internal-host.example.test</html>');

    expect(aiErrorSummary(error)).toBe('AI proxy returned a response that is not a JSON object (200)');
    expect(aiErrorSummary(error)).not.toContain('internal-host.example.test');
  });

  it('redacts the API key from the logged detail', async () => {
    const error = await refusal('echo: Bearer sk-synthetic+key', 'sk-synthetic+key');

    expect(error.message).toBe('AI proxy returned a response that is not a JSON object (200): echo: Bearer [redacted]');
  });

  it('bounds the logged detail', async () => {
    const body = `<html>${'x'.repeat(900)}</html>`;
    const error = await refusal(body);

    expect(error.message.endsWith(` [truncated, ${body.length} chars]`)).toBe(true);
    expect(error.message.length).toBeLessThan(AI_ERROR_DETAIL_LIMIT + 120);
  });

  it.each([
    ['null', 'null'],
    ['a string', '"ok"'],
    ['a number', '42'],
    ['an array', '[]'],
  ])('refuses a body that parses to %s rather than handing it to a caller that reads .choices', async (_label, text) => {
    const error = await refusal(text);

    expect(error.summary).toBe('AI proxy returned a response that is not a JSON object (200)');
  });

  it('refuses an empty body with no detail suffix', async () => {
    const error = await refusal('');

    expect(error.message).toBe('AI proxy returned a response that is not a JSON object (200)');
  });

  it('lets a failed body read propagate unchanged, since that is a transport failure', async () => {
    const torn = new TypeError('terminated');
    const response = { ok: true, status: 200, text: async () => Promise.reject(torn) } as unknown as Response;

    await expect(readAiJson(response, 'test-key')).rejects.toBe(torn);
  });
});
