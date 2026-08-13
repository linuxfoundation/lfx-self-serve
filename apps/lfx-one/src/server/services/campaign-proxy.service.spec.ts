// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as campaign-service.service.spec.ts: the `@lfx-one/shared/*` alias is not wired into
// this app's vitest config, so runtime collaborators are mocked.
const { logger } = vi.hoisted(() => ({
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn(), startOperation: vi.fn(() => 0) },
}));

vi.mock('./logger.service', () => ({ logger }));
vi.mock('./linkedin-ads.service', () => ({ executeLinkedInCampaignCreation: vi.fn(), resolveGeoTargets: vi.fn() }));
vi.mock('./meta-ads.service', () => ({ executeMetaCampaignCreation: vi.fn(), updateMetaCampaignStatus: vi.fn() }));
vi.mock('./reddit-ads.service', () => ({ executeRedditCampaignCreation: vi.fn(), updateRedditCampaignStatus: vi.fn() }));
vi.mock('../helpers/url-validation', () => ({
  validateScrapeUrl: vi.fn(async (u: string) => u),
  // The scrape is not what these tests are about; return empty markup so the stream moves
  // straight on to the copy stage. The `{ html, ok, status }` shape is load-bearing — the caller
  // checks `ok` and aborts the whole stream on a falsy value, which would make every assertion
  // below pass for the wrong reason.
  fetchSafeUrl: vi.fn(async () => ({ html: '<html><body></body></html>', ok: true, status: 200 })),
}));

import type { Request } from 'express';

import { CampaignProxyService } from './campaign-proxy.service';

const req = {} as unknown as Request;

/**
 * The email brief must not generate ad copy — and `platforms` being absent CANNOT carry that,
 * because the generator reads an absent list as the paid default `['google-ads']`.
 *
 * These tests exist because the client-side half of LFXV2-3201 looked complete while the server
 * silently undid it: omitting `platforms` produced Google RSA copy and a keyword list anyway.
 * They assert on which AI calls are made, which is the only place that defect is visible.
 */
describe('CampaignProxyService email delivery type', () => {
  let service: CampaignProxyService;
  /** System prompts of every AI call the stream made, in order. */
  let aiCalls: string[];

  /** Drain an SSE generator into a plain array so it can be asserted on. */
  async function drain(gen: AsyncGenerator<{ type: string; data: unknown }>): Promise<{ type: string; data: unknown }[]> {
    const events: { type: string; data: unknown }[] = [];
    for await (const e of gen) events.push(e);
    return events;
  }

  beforeEach(() => {
    aiCalls = [];
    process.env['AI_PROXY_URL'] = 'https://ai.example.test/v1/chat';
    process.env['AI_API_KEY'] = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const parsed = JSON.parse(init?.body ?? '{}') as { messages?: { role: string; content: string }[] };
        aiCalls.push(parsed.messages?.find((m) => m.role === 'system')?.content ?? '');
        // Valid JSON for every stage, so nothing fails for a reason unrelated to the test.
        //
        // `body` must be a real readable stream, not null: the copy stage uses `aiChatStream`,
        // which reads `response.body`. A null body throws inside the try and the stream yields an
        // 'error' event — which still counts the AI call for our purposes, but leaves the paid
        // contrast test unable to distinguish "call made" from "stage reached and failed".
        const sse = 'data: {"choices":[{"delta":{"content":"{}"}}]}\n\ndata: [DONE]\n\n';
        return {
          ok: true,
          status: 200,
          text: async () => '{}',
          json: async () => ({ choices: [{ message: { content: '{}' } }] }),
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sse));
              controller.close();
            },
          }),
        };
      })
    );

    service = new CampaignProxyService();
  });

  /** Did any AI call carry the ad-copy platform specifications? */
  function generatedAdCopy(): boolean {
    return aiCalls.some((p) => p.includes('PLATFORM SPECIFICATIONS'));
  }

  /** Did any AI call use the Google Ads keyword strategist prompt? */
  function generatedKeywords(): boolean {
    return aiCalls.some((p) => p.includes('Google Ads keyword strategist'));
  }

  it('does not generate ad copy for an email brief', async () => {
    await drain(
      service.streamBrief(req, { url: 'https://events.example.com/kubecon-eu-2026', deliveryType: 'email' }, new AbortController().signal) as AsyncGenerator<{
        type: string;
        data: unknown;
      }>
    );
    expect(generatedAdCopy()).toBe(false);
  });

  it('does not generate keywords for an email brief', async () => {
    await drain(
      service.streamBrief(req, { url: 'https://events.example.com/kubecon-eu-2026', deliveryType: 'email' }, new AbortController().signal) as AsyncGenerator<{
        type: string;
        data: unknown;
      }>
    );
    expect(generatedKeywords()).toBe(false);
  });

  /**
   * The contrast that makes the two above meaningful. `platforms` is absent here too — the ONLY
   * difference is `deliveryType` — so this pins that absence still means the paid default and
   * that the email tests are not passing for some unrelated reason.
   */
  it('still generates ad copy and keywords when platforms is absent but the type is paid', async () => {
    await drain(
      service.streamBrief(req, { url: 'https://events.example.com/kubecon-eu-2026' }, new AbortController().signal) as AsyncGenerator<{
        type: string;
        data: unknown;
      }>
    );
    expect(generatedAdCopy()).toBe(true);
    expect(generatedKeywords()).toBe(true);
  });

  /**
   * A caller CAN send `{deliveryType: 'email', platforms: ['linkedin-ads']}` — the types allow it
   * and this server does not own the client. The LinkedIn strategy branch keys on the platform
   * list alone, so without an explicit email check it would spend an AI call generating a
   * targeting strategy for a brief that has no ad channels.
   */
  it('does not generate a LinkedIn strategy for an email brief that names linkedin-ads', async () => {
    await drain(
      service.streamBrief(
        req,
        { url: 'https://events.example.com/kubecon-eu-2026', deliveryType: 'email', platforms: ['linkedin-ads'] },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );
    expect(aiCalls.some((p) => p.includes('LinkedIn Ads strategist'))).toBe(false);
    expect(generatedAdCopy()).toBe(false);
  });

  it('still generates a LinkedIn strategy for a paid brief naming linkedin-ads', async () => {
    await drain(
      service.streamBrief(
        req,
        { url: 'https://events.example.com/kubecon-eu-2026', platforms: ['linkedin-ads'] },
        new AbortController().signal
      ) as AsyncGenerator<{
        type: string;
        data: unknown;
      }>
    );
    expect(aiCalls.some((p) => p.includes('LinkedIn Ads strategist'))).toBe(true);
  });

  /**
   * Refine re-runs the ad-copy generator, which composes its prompt from per-platform sections
   * and ends with "Keys: <joined>". With no platforms that asks the model for an object with no
   * keys — a broken call, not a cheap one — so an email refine is refused rather than answered.
   */
  it('refuses to refine an email brief instead of issuing an empty ad-copy call', async () => {
    const events = await drain(
      service.streamRefinedBrief(
        req,
        { currentCopy: { subject: 'Join us' }, currentKeywords: [], feedback: 'shorter', deliveryType: 'email' },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(generatedAdCopy()).toBe(false);
  });

  it('still refines a paid brief', async () => {
    await drain(
      service.streamRefinedBrief(
        req,
        { currentCopy: { google_search: {} }, currentKeywords: [], feedback: 'punchier' },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );
    expect(generatedAdCopy()).toBe(true);
  });
});
