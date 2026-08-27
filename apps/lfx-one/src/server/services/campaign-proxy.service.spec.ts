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

import { CampaignProxyService } from './campaign-proxy.service';

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
