// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { CAMPAIGN_DELIVERY_TYPES } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { buildFinalUrl, CampaignProxyService, extractableHtml } from './campaign-proxy.service';

const req = {} as unknown as Request;

/**
 * Derived from the same constant the service interpolates, so adding a delivery type updates this
 * expectation with the code instead of failing on a hand-written list — a second literal here
 * would be the drift this message was just changed to prevent.
 *
 * Asserted by EQUALITY rather than `.includes('deliveryType')`: the substring is satisfied by the
 * word alone, so it passed whether the list rendered correctly, empty, or as `[object Object]` —
 * it could not fail for the thing under test.
 *
 * Built through a `Set` to mirror production's exact transform, not just its output. The two are
 * byte-identical while the ids are unique, so this is defensive: were the constant ever to gain a
 * duplicate id, deriving from the raw array would let this test pass while production — which
 * spreads a Set — rendered something different.
 */
const expectedUnsupportedMessage = `Unsupported deliveryType. Supported: ${[...new Set(CAMPAIGN_DELIVERY_TYPES.map((d) => d.id))].join(', ')}.`;

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
  /** User prompts of every AI call the stream made, in order. */
  let aiUserPrompts: string[];

  /** Drain an SSE generator into a plain array so it can be asserted on. */
  async function drain(gen: AsyncGenerator<{ type: string; data: unknown }>): Promise<{ type: string; data: unknown }[]> {
    const events: { type: string; data: unknown }[] = [];
    for await (const e of gen) events.push(e);
    return events;
  }

  // Captured so `afterEach` can put it back, matching `ai.service.spec.ts`.
  //
  // Hygiene rather than a live bug fix, and worth being precise about which: a review round said
  // the two AI vars below contaminate later specs because `vitest.config.ts` enables neither
  // `unstubGlobals` nor `unstubEnvs`. That part is true, but the config ALSO sets no isolation
  // override, so Vitest's default `isolate: true` gives each FILE a fresh environment — I probed
  // it with a throwaway spec asserting `AI_PROXY_URL` was unset, and it passed with this teardown
  // removed. So nothing leaks across files today.
  //
  // Kept anyway: the guarantee is a default, not a decision this file made, and turning isolation
  // off for speed is an ordinary thing to do later. Restoring what you stub costs nothing and
  // stops that change from quietly breaking a missing-AI-configuration test elsewhere.
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  beforeEach(() => {
    aiCalls = [];
    aiUserPrompts = [];
    process.env['AI_PROXY_URL'] = 'https://ai.example.test/v1/chat';
    process.env['AI_API_KEY'] = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const parsed = JSON.parse(init?.body ?? '{}') as { messages?: { role: string; content: string }[] };
        aiCalls.push(parsed.messages?.find((m) => m.role === 'system')?.content ?? '');
        // The USER message too, in its own list. `aiCalls` records only system prompts, so a
        // platform label restored in a user prompt — where the keyword instruction actually lives
        // — was invisible to every test here: reverting one to "Google Search keywords" left all
        // 1880 specs green. Kept separate rather than pushed into `aiCalls` so the existing
        // `generatedKeywords`/`generatedAdCopy` helpers keep matching only system prompts.
        aiUserPrompts.push(parsed.messages?.find((m) => m.role === 'user')?.content ?? '');
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

  /**
   * Did any AI call use the keyword-strategist prompt?
   *
   * Matches on `keyword strategist` rather than the full sentence. The prompt named only Google
   * Ads until Microsoft was wired onto the same stage, and rewording it silently unhooked this
   * helper: `includes('Google Ads keyword strategist')` went false for every call, so four tests
   * asserting the keyword stage RAN began asserting it had not — a rename read as a behaviour
   * change. The shorter substring survives naming the platforms without matching an unrelated
   * prompt, since no other system prompt in this file mentions keywords.
   */
  function generatedKeywords(): boolean {
    return aiCalls.some((p) => p.includes('keyword strategist'));
  }

  /**
   * `/brief/generate` has a SECOND refinement mode — `refineFeedback` + `previousCopy` — which is
   * another door onto the same refusal. Left open it skipped the scrape (because `isRefinement`)
   * and every generator (because `isEmail`) and then emitted `done`: a successful no-op, worse
   * than an error because the caller is told the work happened.
   */
  it('refuses an email REFINEMENT sent through the generate stream', async () => {
    const events = await drain(
      service.streamBrief(
        req,
        {
          url: 'https://events.example.com/kubecon-eu-2026',
          deliveryType: 'email',
          refineFeedback: 'shorter subject',
          previousCopy: { subject: 'Join us' },
        },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    expect(events.some((e) => e.type === 'error')).toBe(true);
    // NOT a quiet `done`: the whole point is that the caller is not told the refinement happened.
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(generatedAdCopy()).toBe(false);
  });

  /**
   * LFXV2-3312. Microsoft became SELECTABLE in the Plan tab when `disabled: true` was dropped from
   * the shared constant, and the Plan tab sends `selectedPlatforms` straight to this stream — so a
   * `SUPPORTED_PLATFORMS` that omits it makes the very first step of a Microsoft campaign fail
   * with "Unsupported platforms". The channel would be offered and unusable.
   *
   * Asserted as a REACHED-done rather than only an absent error: an early refusal also emits no
   * ad copy, so "no error" alone would pass against the bug this pins.
   */
  it('accepts microsoft-ads for brief generation, which the Plan tab can now select', async () => {
    const events = await drain(
      service.streamBrief(
        req,
        { url: 'https://events.example.com/kubecon-eu-2026', platforms: ['microsoft-ads'] },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.some((e) => e.type === 'done')).toBe(true);
    // Microsoft contributes no copy KEY of its own — its dispatcher auto-composes the ad upstream —
    // but the keyword generator must still run, because keywords are the one brief-derived input
    // `microsoftConfig` consumes, and a campaign without them can never serve.
    expect(generatedKeywords()).toBe(true);
    // And that the prompt NAMES Microsoft. `generatedKeywords()` deliberately matches only
    // `keyword strategist` so a rewording cannot unhook it (see its doc above) — but that
    // looseness means it also passes against the old Google-only prompt. Without this line,
    // reverting KEYWORD_SYSTEM_PROMPT to "for Google Ads" would leave every test green while
    // the model was told to write keywords for the wrong platform.
    expect(aiCalls.some((p) => p.includes('Google Ads and Microsoft Advertising'))).toBe(true);
  });

  /**
   * A Microsoft-ONLY brief contributes no ad-copy keys, so the copy stage is SKIPPED rather than
   * called with an empty schema. This is not a tidiness fix: that stage `return`s the whole stream
   * on failure, so a pointless call failing would abort before the keyword stage — the one stage
   * Microsoft actually needs — and dead-end the first step of the channel.
   */
  it('skips the ad-copy stage for a Microsoft-only brief but still generates keywords', async () => {
    const events = await drain(
      service.streamBrief(
        req,
        { url: 'https://events.example.com/kubecon-eu-2026', platforms: ['microsoft-ads'] },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    expect(generatedAdCopy()).toBe(false);
    expect(generatedKeywords()).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    // Still emits `copy_structured`, with an empty object. Without it the client leaves
    // `structuredCopy` null and `submitRefine` returns silently at its own guard — Refine would
    // do nothing for a Microsoft-only brief, with no message explaining why.
    expect(events.find((e) => e.type === 'copy_structured')?.data).toEqual({});
  });

  /** Microsoft alongside a copy-contributing platform must still generate that platform's copy. */
  it('still generates ad copy when Microsoft is selected with a copy-contributing platform', async () => {
    await drain(
      service.streamBrief(
        req,
        { url: 'https://events.example.com/kubecon-eu-2026', platforms: ['microsoft-ads', 'meta-ads'] },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    expect(generatedAdCopy()).toBe(true);
  });

  it('skips the copy stage on REFINE for a Microsoft-only brief and still regenerates keywords', async () => {
    const events = await drain(
      service.streamRefinedBrief(
        req,
        { currentCopy: {}, currentKeywords: [], feedback: 'more technical', platforms: ['microsoft-ads'] },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    expect(generatedAdCopy()).toBe(false);
    expect(generatedKeywords()).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  /**
   * The keyword instruction lives in the USER prompt, not the system one, so pinning only the
   * system message left the platform label unguarded: reverting a user prompt to "Google Search
   * keywords" kept all 1880 specs green while restoring exactly the conflicting guidance this
   * change removed — a system message naming both platforms beside a user message naming one.
   *
   * Asserted on BOTH paths because there are three such prompts and they drift independently:
   * `buildKeywordPrompt` has an event branch and a training/certification branch, and
   * `buildRefineKeywordPrompt` is a third.
   */
  it('asks for platform-neutral keywords on a Microsoft-only generate', async () => {
    await drain(
      service.streamBrief(
        req,
        { url: 'https://events.example.com/kubecon-eu-2026', platforms: ['microsoft-ads'] },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    const keywordPrompt = aiUserPrompts.find((p) => p.includes('keywords'));
    expect(keywordPrompt).toBeDefined();
    // Positive AND negative: the positive alone would pass on a prompt that named both.
    expect(keywordPrompt).toContain('paid search keywords');
    expect(keywordPrompt).not.toMatch(/Google Search keywords/i);
  });

  /**
   * The education branch of `buildKeywordPrompt`, selected by `programType === 'education'`. It is
   * a THIRD prompt and drifts independently — reverting it alone left the two tests above green,
   * which is why it gets its own case rather than being assumed covered by them.
   */
  it('asks for platform-neutral keywords on a Microsoft-only education generate', async () => {
    await drain(
      service.streamBrief(
        req,
        { url: 'https://training.example.com/cka', platforms: ['microsoft-ads'], programType: 'education' },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    const keywordPrompt = aiUserPrompts.find((p) => p.includes('keywords'));
    expect(keywordPrompt).toBeDefined();
    // Confirms this is the education branch and not the event one, so a future edit that stops
    // selecting it cannot leave this test passing against the wrong prompt.
    expect(keywordPrompt).toContain('training/certification program');
    expect(keywordPrompt).toContain('paid search keywords');
    expect(keywordPrompt).not.toMatch(/Google Search keywords/i);
  });

  it('asks for platform-neutral keywords on a Microsoft-only refine', async () => {
    await drain(
      service.streamRefinedBrief(
        req,
        { currentCopy: {}, currentKeywords: [], feedback: 'more technical', platforms: ['microsoft-ads'] },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    const keywordPrompt = aiUserPrompts.find((p) => p.includes('keywords'));
    expect(keywordPrompt).toBeDefined();
    expect(keywordPrompt).toContain('paid search keywords');
    expect(keywordPrompt).not.toMatch(/Google Search keywords/i);
  });

  /** The contrast: a platform this service genuinely cannot serve is still refused by name. */
  it('still refuses twitter-ads, which the brief generator does not serve', async () => {
    const events = await drain(
      service.streamBrief(
        req,
        { url: 'https://events.example.com/kubecon-eu-2026', platforms: ['twitter-ads'] },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect(String(error?.data)).toContain('twitter-ads');
    // The message enumerates the live set, so it names microsoft-ads as supported rather than
    // carrying a stale hand-written list.
    expect(String(error?.data)).toContain('microsoft-ads');
  });

  it('does not generate ad copy for an email brief, and still completes', async () => {
    const events = await drain(
      service.streamBrief(req, { url: 'https://events.example.com/kubecon-eu-2026', deliveryType: 'email' }, new AbortController().signal) as AsyncGenerator<{
        type: string;
        data: unknown;
      }>
    );

    expect(generatedAdCopy()).toBe(false);

    // The absence assertion alone is satisfied by an email brief that FAILS — remove 'email' from
    // the supported delivery types and the stream errors out early, generating no ad copy and
    // passing. So assert the stream reached `done` and emitted no `error`: the email path must be
    // usable, not merely quiet.
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
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
   * The dangerous direction of a bad value: a typo falls through `=== 'email'` as paid marketing,
   * so a request that MEANT to suppress ad generation would cause it instead. Rejected rather
   * than defaulted, matching how the adjacent `platforms` and `programType` fields behave.
   */
  it('rejects an unrecognised deliveryType instead of treating it as paid', async () => {
    const events = await drain(
      service.streamBrief(
        req,
        { url: 'https://events.example.com/kubecon-eu-2026', deliveryType: 'emial' as 'email' },
        new AbortController().signal
      ) as AsyncGenerator<{
        type: string;
        data: unknown;
      }>
    );

    expect(events.some((e) => e.type === 'error' && String(e.data) === expectedUnsupportedMessage)).toBe(true);
    expect(generatedAdCopy()).toBe(false);
    expect(generatedKeywords()).toBe(false);
  });

  it('rejects an unrecognised deliveryType on refine', async () => {
    const events = await drain(
      service.streamRefinedBrief(
        req,
        { currentCopy: { google_search: {} }, currentKeywords: [], feedback: 'shorter', deliveryType: 'emial' as 'email' },
        new AbortController().signal
      ) as AsyncGenerator<{ type: string; data: unknown }>
    );

    expect(events.some((e) => e.type === 'error' && String(e.data) === expectedUnsupportedMessage)).toBe(true);
    expect(generatedAdCopy()).toBe(false);
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

/**
 * Isolated from the delivery-type block above deliberately.
 *
 * `createCampaign` starts a REAL job and polls it, so it outlives the test that started it and
 * would clobber that block's shared `fetch` stub — its `aiCalls` recorder came back empty for
 * four sibling tests when this lived there. Its own describe means its background work cannot
 * reach them.
 */
/**
 * The model is asked for bare JSON and usually obliges, but it wraps the payload in a ```json
 * fence often enough that this broke every email brief in local testing: `JSON.parse` rejects the
 * fence, extraction throws, and the catch downgrades it to "continuing with the URL only". The
 * stream then completes with a 200 and no `event` frame at all, so the UI has no event details to
 * show and the failure reads as a page the AI could not understand.
 *
 * `stripJsonFences` already existed and was already applied to the copy and keyword stages — the
 * defect was that extraction and the LinkedIn strategy stage never called it. So this pins the
 * omission, not the helper.
 */
describe('CampaignProxyService model JSON fences', () => {
  let service: CampaignProxyService;
  const originalEnv = { ...process.env };

  async function drain(gen: AsyncGenerator<{ type: string; data: unknown }>): Promise<{ type: string; data: unknown }[]> {
    const events: { type: string; data: unknown }[] = [];
    for await (const e of gen) events.push(e);
    return events;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  /** Stub every AI call to answer with `payload`, verbatim — fence and all. */
  function stubAiReturning(payload: string): void {
    process.env['AI_PROXY_URL'] = 'https://ai.example.test/v1/chat';
    process.env['AI_API_KEY'] = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => payload,
        json: async () => ({ choices: [{ message: { content: payload } }] }),
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{}"}}]}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        }),
      }))
    );
    service = new CampaignProxyService();
  }

  const details =
    '{"name":"KubeCon EU 2026","dates":"March 3-4, 2026","city":"Amsterdam","country_code":"NL","audience":"Developers","themes":[],"registration_url":"https://events.example.com/kubecon-eu-2026","speakers":[],"slug":"kubecon-eu-2026","format_notes":""}';

  it('extracts event details from a fenced response', async () => {
    stubAiReturning('```json\n' + details + '\n```');
    const events = await drain(
      service.streamBrief(req, { url: 'https://events.example.com/kubecon-eu-2026', deliveryType: 'email' }, new AbortController().signal) as AsyncGenerator<{
        type: string;
        data: unknown;
      }>
    );

    const eventFrame = events.find((e) => e.type === 'event');
    // Asserting the frame AND its payload: before the fix no `event` frame was emitted at all,
    // and a frame carrying an empty name would be just as broken for the UI downstream.
    expect(eventFrame).toBeDefined();
    expect((eventFrame?.data as { name: string }).name).toBe('KubeCon EU 2026');
  });

  it('still extracts details from an unfenced response', async () => {
    stubAiReturning(details);
    const events = await drain(
      service.streamBrief(req, { url: 'https://events.example.com/kubecon-eu-2026', deliveryType: 'email' }, new AbortController().signal) as AsyncGenerator<{
        type: string;
        data: unknown;
      }>
    );

    expect((events.find((e) => e.type === 'event')?.data as { name: string }).name).toBe('KubeCon EU 2026');
  });
});

describe('CampaignProxyService legacy platform gate', () => {
  const req = {} as unknown as Request;
  const service = new CampaignProxyService();

  /**
   * Microsoft is the FIRST channel that requires the cutover flags, so the legacy path is the
   * thing that answers when they are dark: `createCampaigns` reports `enabled: false`, the request
   * falls through here, and `supportedPlatforms` must produce an explicit "Unsupported
   * platform(s)" error.
   *
   * Locked by a test because the failure mode of getting it wrong is SILENT. Every entry in that
   * list has an `execute<Platform>Dispatch` behind it and Microsoft has none — it exists only as
   * `MicrosoftDispatcher` in campaign-service — so adding `microsoft-ads` to the list to "fix" a
   * refusal would turn the error into a create that quietly does nothing, reporting success for a
   * campaign that was never made. The omission is deliberate; this is what says so in code.
   */
  it('refuses microsoft-ads on the legacy path rather than creating nothing', async () => {
    const result = await service.createCampaign(req, {
      eventName: 'KubeCon EU 2026',
      eventSlug: 'kubecon-eu-2026',
      platforms: ['microsoft-ads'],
      // SUPPLIED so this test cannot reach HubSpot. `executeCampaignCreation` calls
      // `resolveHubSpotUtm` whenever `hsToken` is absent, and that helper does not merely READ —
      // it calls `hubspotCreateCampaign`. This block's `afterEach` restores the real environment
      // and the real global `fetch`, so on a machine with HUBSPOT_ACCESS_TOKEN set, a unit test
      // asserting a platform refusal would have created a campaign in HubSpot. Only the token
      // being unset stood between this and a real write.
      //
      // A dummy value rather than a stub: it short-circuits the branch entirely, so the test
      // cannot depend on how the lookup is mocked, and nothing downstream reads it — the create
      // is refused before any dispatch.
      hsToken: 'test-hs-token',
    } as unknown as Parameters<typeof service.createCampaign>[1]);

    const text = JSON.stringify(result);
    // The platform is NAMED, so an operator can see which one was refused.
    expect(text).toContain('microsoft-ads');
    expect(text).toMatch(/Unsupported platform/i);
    // And the four that ARE wired are still offered, so the message says what to do instead.
    expect(text).toContain('google-ads');
  });
});

describe('extractableHtml', () => {
  // The regression this function exists to prevent. Measured on the Open Source Summit Japan page:
  // 151,727 bytes total, of which 62,784 are `<style>` and 38,281 are `<script>`; the venue string
  // sits at byte 30,351, just past the old blind `slice(0, 30_000)`. The extractor was handed a
  // window that was almost entirely CSS, reported the facts absent, and downstream copy invented
  // replacements. These pin the properties that make that impossible rather than the byte counts,
  // which belong to one page and would rot.
  it('keeps prose that a fixed 30k slice would have cut, by removing style and script first', () => {
    const html = `<style>${'a{color:red}'.repeat(3000)}</style><p>Tokyo, December 7-9 2026</p>`;

    expect(html.slice(0, 30_000)).not.toContain('Tokyo');
    expect(extractableHtml(html)).toContain('Tokyo, December 7-9 2026');
  });

  // JSON-LD is where event pages most reliably publish `startDate`/`endDate`/`location` as
  // machine-readable schema.org data -- exactly the fields the extraction prompt asks for. An
  // earlier revision stripped every `<script>`, which discarded it and kept the "no date survived"
  // failure alive for any page whose dates live only there.
  it('preserves application/ld+json while stripping every other script', () => {
    const html =
      `<script type="application/ld+json">{"startDate":"2027-03-15","location":"Barcelona"}</script>` + `<script>var tracking = 1;</script><p>prose</p>`;

    const out = extractableHtml(html);

    expect(out).toContain('"startDate":"2027-03-15"');
    expect(out).toContain('Barcelona');
    expect(out).not.toContain('var tracking');
    expect(out).toContain('prose');
  });

  // Prepended, not appended: the cap truncates the TAIL, so a page long enough to hit it must not
  // be able to push the structured facts out of the window.
  it('keeps json-ld even when the stripped body fills the entire cap', () => {
    const html = `<script type="application/ld+json">{"startDate":"2027-03-15"}</script><p>${'x'.repeat(200_000)}</p>`;

    expect(extractableHtml(html)).toContain('"startDate":"2027-03-15"');
  });

  it('removes style, svg and comments', () => {
    const out = extractableHtml('<style>.a{color:red}</style><svg><path d="M0"/></svg><!-- note --><p>kept</p>');

    expect(out).not.toContain('color:red');
    expect(out).not.toContain('<path');
    expect(out).not.toContain('note');
    expect(out).toContain('kept');
  });

  // The cap is the only bound on what reaches the prompt, so it has to hold for input that
  // survives stripping entirely.
  it('caps the stripped body', () => {
    expect(extractableHtml('<p>' + 'y'.repeat(200_000) + '</p>').length).toBeLessThanOrEqual(60_000);
  });

  // The case the cap test above CANNOT reach, and the one that matters most. An earlier revision
  // composed the result as `jsonLd + stripped.slice(0, 60_000)`, bounding only the second term:
  // a 500KB `ld+json` block produced 500,055 characters against a documented 60,000 cap. The
  // preserved-JSON-LD fix introduced that hole, which is why each arm needs its own assertion --
  // a test that feeds only prose exercises the one path that was already bounded.
  //
  // JSON-LD is the more attacker-controllable of the two: it is machine-written and invisible on
  // the rendered page, and nothing upstream bounds the download (`fetchSafeUrl` has a 15s timeout
  // and no byte ceiling), so this is the last line of defence on prompt size.
  it('caps the composed result, not merely the stripped body', () => {
    const hugeLd = `<script type="application/ld+json">${'x'.repeat(500_000)}</script><p>short</p>`;
    const hugeBoth = `<script type="application/ld+json">${'x'.repeat(500_000)}</script><p>${'y'.repeat(500_000)}</p>`;

    expect(extractableHtml(hugeLd).length).toBeLessThanOrEqual(60_000);
    expect(extractableHtml(hugeBoth).length).toBeLessThanOrEqual(60_000);
  });

  // Budgeted rather than truncated wholesale: an oversized JSON-LD block must not starve the prose
  // of the entire budget, or a page whose facts are in prose loses them to a block of markup.
  it('leaves budget for prose when json-ld is oversized', () => {
    const out = extractableHtml(`<script type="application/ld+json">${'x'.repeat(500_000)}</script><p>Tokyo</p>`);

    expect(out).toContain('Tokyo');
  });

  // HTML permits whitespace between a closing tag's name and its `>`, and browsers honour it, so
  // `</script >` closes the element exactly as `</script>` does. A stripper anchored on `</script>`
  // matches neither and leaves the WHOLE element -- body included -- in the output. Reported by
  // CodeQL as "Bad HTML filtering regexp"; all four patterns here had it, not only the one flagged.
  //
  // Asserted per-variant rather than in one blob because each `.replace` is its own regex: a fix
  // applied to `script` alone would still pass a test that only fed it a script tag.
  it.each([
    ['space', '<script>alert(1)</script >'],
    ['tab', '<script>alert(1)</script\t>'],
    ['newline', '<script>alert(1)</script\n>'],
    // CodeQL's SECOND report, after a `\s*>` fix closed only the whitespace cases. An end tag is
    // `</` name then anything up to `>`, so junk after the name still closes the element.
    ['whitespace then junk', '<script>alert(1)</script\t\n bar>'],
    ['attribute-shaped junk', '<script>alert(1)</script foo=bar>'],
  ])('strips a script closed with %s before the bracket', (_label, markup) => {
    const out = extractableHtml(`<p>before</p>${markup}<p>after</p>`);

    expect(out).not.toContain('alert(1)');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  // The leading `\s` in `<\/script(\s[^>]*)?>` is load-bearing. Without it the pattern would also
  // swallow `</scriptx>`, which names a different tag and closes nothing — so everything from the
  // opening tag to the next real `</script>` would vanish, silently deleting page content.
  it('does not treat a longer tag name as a closing script tag', () => {
    const out = extractableHtml('<p>before</p><script>alert(1)</scriptx>INSIDE</script><p>after</p>');

    // `</scriptx>` closes nothing, so the element runs to the REAL `</script>` and everything
    // between goes with it. Asserting only that `alert(1)` is gone would not discriminate: the
    // `\s`-less pattern also removes it, just by stopping at the wrong tag. What separates the
    // two is whether `INSIDE` — text after the decoy and still inside the script — survives.
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('INSIDE');
    expect(out).not.toContain('</script');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('strips style and svg closed with whitespace before the bracket', () => {
    const out = extractableHtml('<style>.a{color:red}</style ><svg><path d="M0"/></svg ><p>kept</p>');

    expect(out).not.toContain('color:red');
    expect(out).not.toContain('<path');
    expect(out).toContain('kept');
  });

  // The JSON-LD matcher is a fourth copy of the same closing pattern. It fails the OTHER way: a
  // block closed `</script >` goes unmatched here and is then stripped as an ordinary script, so
  // the structured event facts the extraction depends on are silently lost rather than leaked.
  it('preserves json-ld closed with whitespace before the bracket', () => {
    const out = extractableHtml('<script type="application/ld+json">{"startDate":"2027-03-15"}</script ><p>x</p>');

    expect(out).toContain('"startDate":"2027-03-15"');
  });

  // `data-type="application/ld+json"` is not the `type` attribute. Matching any attribute name
  // ENDING in `type` copied an ordinary script into `jsonLd`, where it survived the strip below
  // and reached the extraction prompt as attacker-controllable text — the same leak the end-tag
  // fixes closed, through the attribute side instead.
  it.each([
    ['data-type decoy', '<script type="text/javascript" data-type="application/ld+json">alert(1)</script>'],
    ['xtype decoy', '<script xtype="application/ld+json">alert(1)</script>'],
  ])('does not treat %s as json-ld', (_label, markup) => {
    const out = extractableHtml(`${markup}<p>KEPT</p>`);

    expect(out).not.toContain('alert(1)');
    expect(out).toContain('KEPT');
  });

  // The real attribute must still match, including the spacing HTML permits around `=`.
  it.each([
    ['plain', '<script type="application/ld+json">{"startDate":"2027-03-15"}</script>'],
    ['spaced equals', '<script type = "application/ld+json">{"startDate":"2027-03-15"}</script>'],
    ['single quotes', '<script type=\'application/ld+json\'>{"startDate":"2027-03-15"}</script>'],
    ['other attributes', '<script id="ld" type="application/ld+json" defer>{"startDate":"2027-03-15"}</script>'],
  ])('preserves json-ld written with %s', (_label, markup) => {
    expect(extractableHtml(`${markup}<p>x</p>`)).toContain('"startDate":"2027-03-15"');
  });

  // A custom element sharing a stripped tag's PREFIX must not start a match. `<svg-icon>` begins
  // with `<svg`, so without a boundary assertion the strip ran from there to the next real
  // `</svg>` and deleted every bit of event prose in between. That is the opposite failure from
  // the closing-tag cases above: not content surviving that should be stripped, but content
  // stripped that should survive — and on an extraction prompt, silently losing the event's own
  // description is the worse of the two.
  it.each([
    ['svg-icon', '<svg-icon>KEEP THIS PROSE</svg-icon><svg><path d="M0"/></svg>'],
    ['style-guide', '<style-guide>KEEP THIS PROSE</style-guide><style>.a{color:red}</style>'],
    ['scriptorium', '<scriptorium>KEEP THIS PROSE</scriptorium><script>alert(1)</script>'],
  ])('does not let <%s> start a strip', (_label, markup) => {
    const out = extractableHtml(`${markup}<p>after</p>`);

    expect(out, 'a prefix-sharing custom element swallowed the prose after it').toContain('KEEP THIS PROSE');
    expect(out).toContain('after');
    // The REAL element is still stripped; the boundary must not weaken that.
    expect(out).not.toContain('<path');
    expect(out).not.toContain('color:red');
    expect(out).not.toContain('alert(1)');
  });

  // A pathological page must not stall the SSR event loop. Every stripper is lazy-quantified, so
  // an unclosed `<style ` makes each start position scan to end-of-document for a close that never
  // arrives -- quadratic in the count, and Node is single-threaded, so the whole BFF freezes for
  // every concurrent user while it runs. Any authenticated user can supply the scrape URL.
  //
  // The assertion is a TIME budget rather than a length one, because length is not what hurts:
  // capping the OUTPUT leaves the work already done. 2s is deliberately loose against the ~0.4s
  // this should take -- CI machines are slower and a flaky perf test is worse than none -- but it
  // is far below the ~6s the unbounded version took on this exact input.
  it('does not stall on an adversarial page of unclosed tags', () => {
    const evil = '<style '.repeat(80_000);

    const started = Date.now();
    const out = extractableHtml(`${evil}<p>Tokyo</p>`);
    const elapsed = Date.now() - started;

    // 4s, not 2s. Locally this is ~0.4s and the unbounded version was ~6.1s, so the budget only has
    // to separate those two -- and a shared CI runner sits between them: 2s failed there at 2212ms
    // while the cap was working correctly. A perf assertion that fails on a slow runner teaches
    // people to re-run CI, which is worse than no assertion.
    expect(elapsed, `extractableHtml took ${elapsed}ms on 80k unclosed <style tokens; the input cap is not applied`).toBeLessThan(4000);
    expect(out.length).toBeLessThanOrEqual(60_000);
  });

  // The source cap must not become the binding constraint on ordinary pages: what a large
  // templated page strips down to has to stay above the OUTPUT cap, or truncation would start
  // deciding what the prompt sees instead of the 60k budget doing it.
  //
  // Asserted as "still fills the output cap", not "this specific prose survives" -- a first
  // version of this test put prose after 81k of boilerplate and failed, but on the pre-existing
  // 60k output slice rather than on the new truncation. That would have pinned the wrong thing.
  it('leaves a large templated page still filling the output cap', () => {
    const boiler = '<div class="wrapper"><span class="x">   </span></div>\n'.repeat(1500);

    const out = extractableHtml(`${boiler}<p>KubeCon Europe, Amsterdam</p>${boiler}`);

    expect(out.length, 'the source cap now binds before the output cap does').toBe(60_000);
  });

  // Prose EARLY in such a page -- where an event's own description sits -- must survive both caps.
  it('keeps prose that precedes the boilerplate', () => {
    const boiler = '<div class="wrapper"><span class="x">   </span></div>\n'.repeat(1500);

    expect(extractableHtml(`<p>KubeCon Europe, Amsterdam</p>${boiler}`)).toContain('Amsterdam');
  });

  // The JSON-LD matcher runs BEFORE the source cap, so it needs its own bound. Its lazy span makes
  // every UNMATCHED opening rescan the rest of the document — quadratic in the opening count, and
  // measured at ~7.7s for 40k openings. An earlier version of this file claimed this matcher was
  // "anchored and costs ~1ms": true against `<style` input, wrong for its own worst case.
  it('does not stall on a page full of unmatched json-ld openings', () => {
    // `'<script '` with NO `>` anywhere, which is the shape that actually stalls. An earlier
    // version of this test used `'<script type="application/ld+json">'.repeat(...)`: every token
    // contains `>`, so the greedy attribute span never backtracks, the count short-circuits at 65
    // openings, and the whole thing finished in 1ms — green while the production stall was intact.
    // On this input the same code path took ~13.5s across both JSON-LD passes.
    const evil = '<script '.repeat(50_000);

    const started = Date.now();
    const out = extractableHtml(`${evil}<p>Tokyo</p>`);
    const elapsed = Date.now() - started;

    // 4s for the same reason as the sibling test above: separate this from the ~13.5s the
    // unbounded attribute spans cost, with room for a loaded CI runner in between.
    expect(elapsed, `extractableHtml took ${elapsed}ms on 40k unmatched json-ld openings`).toBeLessThan(4000);
    expect(out.length).toBeLessThanOrEqual(60_000);
  });

  // At the FULL download ceiling, which is the largest body that can now reach this function.
  //
  // This is what makes `MAX_JSON_LD_SCAN_CHARS` honest about its own role: with the attribute
  // spans bounded the JSON-LD passes are LINEAR, so 5 MiB costs ~1s rather than growing
  // quadratically, and the 1 MiB scan cap is defence in depth rather than the thing holding this
  // up. Removing that cap alone does not fail a test, and the comment says so instead of implying
  // it is load-bearing.
  it('stays bounded at the full fetch ceiling', () => {
    const fiveMiB = '<script '.repeat((5 * 1024 * 1024) / 8);

    const started = Date.now();
    extractableHtml(fiveMiB);

    expect(Date.now() - started, 'the json-ld passes are not linear at the download ceiling').toBeLessThan(6000);
  });

  it('returns an empty string for input that is entirely strippable', () => {
    expect(extractableHtml('<style>.a{color:red}</style>').trim()).toBe('');
  });
});

/**
 * The HubSpot campaign lookup. Two contracts are load-bearing and neither is visible from the
 * shape of the result: a token this code did not receive from HubSpot must never be invented,
 * and a capped search must say so rather than pass as proof of absence.
 */
describe('CampaignProxyService HubSpot campaign lookup', () => {
  let service: CampaignProxyService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new CampaignProxyService();
    // Every test in this block MUST have the stub installed before it runs. `hubspotSearchCampaign`
    // calls the real global fetch, so a test sitting outside this beforeEach would reach HubSpot
    // for real on any machine with HUBSPOT_ACCESS_TOKEN set.
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('HUBSPOT_ACCESS_TOKEN', 'test-hs-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function hsResponds(body: unknown): void {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  }

  it('reports a campaign with no hs_utm as having no token, rather than inventing one', async () => {
    // `${id}-${name}` is not a token HubSpot ever issued. A link built from it attributes traffic
    // to a campaign HubSpot cannot report on, so the spend LOOKS tracked while the attribution
    // goes nowhere — strictly worse than saying the token is absent.
    hsResponds({ total: 1, results: [{ id: '42', properties: { hs_name: 'KubeCon EU 2026' } }] });

    const result = await service.lookupHubSpotUtm(req, 'KubeCon EU 2026');

    expect(result.hs_utm).toBeNull();
    expect(JSON.stringify(result)).not.toContain('42-KubeCon');
    // And it is not offered as a selectable alternative either: the picker writes the chosen
    // token into the field, so a tokenless row has nothing to select.
    expect(result.all_matches).toEqual([]);
  });

  it.each([
    ['omits utm_campaign entirely when HubSpot issued no token', undefined, false],
    ['carries a real token through', 'kubecon-na-2026', true],
  ])('%s', (_label, hsToken, expectPresent) => {
    // `body.hsToken || slug` fabricated a plausible event-slug token HubSpot never minted -- the
    // exact behaviour this cutover removes from the LOOKUP path, reinstated one layer down in
    // the tracking URL where it is harder to see. A fabricated token is indistinguishable from a
    // real one and attributes traffic to a campaign HubSpot cannot report on; an absent
    // parameter is visibly absent and reads as untagged rather than mis-tagged.
    const url = buildFinalUrl(
      { registrationUrl: 'https://events.example.com/kubecon', eventName: 'KubeCon NA 2026', eventSlug: 'kubecon-na-2026', hsToken } as never,
      'search'
    );

    expect(url.includes('utm_campaign='), 'utm_campaign presence').toBe(expectPresent);
    if (expectPresent) expect(url).toContain('utm_campaign=kubecon-na-2026');
    // utm_term legitimately carries the slug, so the assertion above must be on the PARAMETER.
    expect(url).toContain('utm_term=kubecon-na-2026');
  });

  it("does not take another campaign's token after creating one", async () => {
    // The create path follows up with a FUZZY name search at limit:1, so results[0] is whatever
    // HubSpot ranked first for that name -- on a portal with an older similarly named campaign,
    // that is not the campaign just created. Taking it assigned the OLD campaign's token and id
    // to the NEW one, so the new campaign's links would have reported into the old campaign's
    // attribution. Only the row carrying our uuid can describe our campaign.
    fetchMock
      // 1. the create itself
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'new-uuid' }), text: async () => '{}' })
      // 2. the follow-up search returns an OLDER campaign of a similar name
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: 'old-uuid', properties: { hs_utm: 'someone-elses-token' } }] }),
        text: async () => '{}',
      });

    const result = await service.createHubSpotUtm(req, 'KubeCon NA 2026');

    expect(result.hs_utm, "took another campaign's UTM token").not.toBe('someone-elses-token');
    expect(result.hs_utm).toBeNull();
    expect(result.created).toBe(true);
  });

  it('refuses to auto-apply when two candidates tie on score', async () => {
    // scoreCampaignName now compares NORMALISED names, so two campaigns differing only by
    // whitespace score the SAME where the double-space row used to lose outright. `sort` is
    // stable, so matches[0] is then whichever row HubSpot returned first -- an ordering that says
    // nothing about relevance -- and the planning tab writes a `found` token straight into the
    // event's links with no operator step.
    //
    // This is the PRODUCTION DEFAULT path (LFX_CUTOVER_CAMPAIGN_SERVICE_HUBSPOT_UTM ships false),
    // so it needs the same gate the mapper path has rather than a tie-break from HubSpot's order.
    hsResponds({
      total: 2,
      results: [
        { id: '1', properties: { hs_name: 'KubeCon  NA 2026', hs_utm: 'wrong-token' } },
        { id: '2', properties: { hs_name: 'KubeCon NA 2026', hs_utm: 'right-token' } },
      ],
    });

    const result = await service.lookupHubSpotUtm(req, 'KubeCon NA 2026');

    expect(result.found, 'auto-applied a token on a tie decided by HubSpot row order').toBe(false);
    expect(result.hs_utm).toBeNull();
    // Both still travel so the operator can pick.
    expect(result.all_matches).toHaveLength(2);
    expect(result.inconclusive).toBe(true);
  });

  it('withholds a tokenless found from a client that does not declare the capability', async () => {
    // An EXACT match that carries no UTM token. This path reports it as `found: true` with a null
    // token -- a tokenless campaign still counts as a match, which is what suppresses the
    // duplicate create -- but the PREVIOUS bundle branches on `found && hs_utm` and reads
    // anything else as absence, so it offers Create for a campaign that already exists.
    //
    // Reachable on any rolling deploy (new replica set, no session affinity), and this is the
    // PRODUCTION DEFAULT path, so it is the one shipping today.
    hsResponds({ total: 1, results: [{ id: '7', properties: { hs_name: 'KubeCon EU 2026' } }] });

    const result = await service.lookupHubSpotUtm(req, 'KubeCon EU 2026');

    // Downgraded to a shape the old bundle CAN read...
    expect(result.found, 'a tokenless found reached a client that cannot parse it').toBe(false);
    expect(result.hs_utm).toBeNull();
    // ...but never as proven absence, which is what would license the create.
    expect(result.inconclusive, 'an existing campaign was reported as proven absence').toBe(true);
  });

  it('reports the tokenless found to a client that DOES declare the capability', async () => {
    hsResponds({ total: 1, results: [{ id: '7', properties: { hs_name: 'KubeCon EU 2026' } }] });

    const result = await service.lookupHubSpotUtm(req, 'KubeCon EU 2026', true);

    expect(result.found).toBe(true);
    expect(result.hs_utm).toBeNull();
    expect(result.campaign_name).toBe('KubeCon EU 2026');
  });

  it('refuses a LONE weak match, matching the mapper path', async () => {
    // dealako (#2079): refusing ties alone still auto-applied a single weak match. One campaign
    // sharing one long word with the event name scores on containment and wins by default, and
    // the planning tab writes its UTM straight into the brief's links.
    //
    // The mapper path requires an exact NORMALISED match before `found: true`. Two paths behind
    // one flag must not disagree about what counts as a match, or flipping
    // LFX_CUTOVER_CAMPAIGN_SERVICE_HUBSPOT_UTM silently changes which campaign a brief attributes
    // to -- and this is the production default, so the weak answer is the one shipping today.
    hsResponds({ total: 1, results: [{ id: '9', properties: { hs_name: 'KubeCon EU 2025 Sponsor Booth', hs_utm: 'unrelated-token' } }] });

    const result = await service.lookupHubSpotUtm(req, 'KubeCon NA 2026');

    expect(result.found, 'auto-applied a weak single match the mapper path would refuse').toBe(false);
    expect(result.hs_utm).toBeNull();
    // The candidate still travels, so the operator can pick it deliberately.
    expect(result.all_matches).toHaveLength(1);
    expect(result.inconclusive).toBe(true);
  });

  it('carries a real hs_utm through untouched', async () => {
    // The other direction, so the guard above cannot be satisfied by nulling every token.
    hsResponds({ total: 1, results: [{ id: '42', properties: { hs_name: 'KubeCon EU 2026', hs_utm: 'kubecon-eu-2026' } }] });

    const result = await service.lookupHubSpotUtm(req, 'KubeCon EU 2026');

    expect(result.hs_utm).toBe('kubecon-eu-2026');
    expect(result.found).toBe(true);
  });

  it('does not create a second campaign when a tokenless one already exists', async () => {
    // The bug this guards: `found && hsUtm` skipped the create only when a token was PRESENT.
    // Once tokenless matches correctly return null, that condition became false for a campaign
    // that EXISTS -- so brief generation and the legacy create would make a duplicate for the
    // same event, every time they ran. Creating a second campaign is not a way to obtain the
    // first one's token.
    //
    // Driven through createCampaign with hsToken ABSENT, because that is the only route to the
    // module-private resolver -- and it is the route that would actually duplicate.
    hsResponds({ total: 1, results: [{ id: '42', properties: { hs_name: 'KubeCon EU 2026' } }] });

    await service.createCampaign(req, {
      eventName: 'KubeCon EU 2026',
      eventSlug: 'kubecon-eu-2026',
      platforms: ['microsoft-ads'],
    } as unknown as Parameters<typeof service.createCampaign>[1]);
    // The job runs detached; let its first await settle.
    await new Promise((r) => setTimeout(r, 0));

    const created = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/marketing/v3/campaigns'));
    expect(created, 'a campaign that already exists must not be created again').toHaveLength(0);
  });

  it('does not auto-create when the search was inconclusive but not truncated', async () => {
    // The guard has to ask the WIDER question. `capped` and `inconclusive` were one field until
    // `capped` was narrowed to truncation only -- and a search HubSpot answered IN FULL, whose
    // rows the local scorer rejected, reports `capped: false` while one of those rows may be
    // exactly the campaign a create would duplicate. Keying on `capped` here silently
    // reintroduced the duplicate-create bug.
    //
    // Total equals the returned count (not truncated), but the row does not score against the
    // query (inconclusive).
    hsResponds({ total: 1, results: [{ id: '42', properties: { hs_name: 'Totally Unrelated Thing', hs_utm: 'u' } }] });

    await service.createCampaign(req, {
      eventName: 'KubeCon EU 2026',
      eventSlug: 'kubecon-eu-2026',
      platforms: ['microsoft-ads'],
    } as unknown as Parameters<typeof service.createCampaign>[1]);
    await new Promise((r) => setTimeout(r, 0));

    const created = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/marketing/v3/campaigns'));
    expect(created, 'auto-created a campaign on a search that settled nothing').toHaveLength(0);
  });

  it('asks HubSpot for its per-request maximum, not a smaller number', async () => {
    // The cap is part of the duplicate-avoidance contract: every row it omits is a campaign a
    // caller can duplicate, and a limit BELOW the API maximum makes `capped` fire on searches
    // HubSpot would happily have answered in full -- suppressing the create for no reason.
    // 200 since September 2024; nothing else asserted this, so lowering it was invisible.
    hsResponds({ total: 0, results: [] });

    await service.lookupHubSpotUtm(req, 'KubeCon EU 2026');

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as { body: string }).body));
    expect(body.limit, 'asked HubSpot for fewer rows than it will return').toBe(200);
  });

  it('refuses a malformed 2xx rather than reading it as an empty search', async () => {
    // A body with no `results` array is a response we could not parse. Defaulting it to `[]`
    // turned that into an AUTHORITATIVE absence -- and absence is what the caller acts on by
    // creating a campaign, so a HubSpot hiccup became a duplicate.
    hsResponds({ total: 0 });

    await expect(service.lookupHubSpotUtm(req, 'KubeCon EU 2026')).rejects.toThrow(/malformed/i);
  });

  it('treats an absent total as unknown completeness, not zero', async () => {
    // Defaulting the total to 0 made `capped` false and reported the search as PROVEN complete,
    // which is precisely the licence to create.
    hsResponds({ results: [] });

    const result = await service.lookupHubSpotUtm(req, 'KubeCon EU 2026');

    expect(result.found).toBe(false);
    expect(result.capped, 'an unknown completeness read as proven-complete').toBe(true);
    expect(result.inconclusive).toBe(true);
  });

  it('reports capped when HubSpot matched more campaigns than it returned', async () => {
    hsResponds({ total: 250, results: [{ id: '1', properties: { hs_name: 'Unrelated', hs_utm: 'u' } }] });

    const result = await service.lookupHubSpotUtm(req, 'KubeCon EU 2026');

    expect(result.capped).toBe(true);
  });

  it('does not report capped on a complete result set', async () => {
    // Derived from HubSpot's total, not from the returned count: an exactly-full page and a
    // truncated one are the same length, and a warning that never clears is one operators learn
    // to ignore.
    hsResponds({ total: 0, results: [] });

    const result = await service.lookupHubSpotUtm(req, 'KubeCon EU 2026');

    expect(result.capped).toBe(false);
    expect(result.found).toBe(false);
  });
});
