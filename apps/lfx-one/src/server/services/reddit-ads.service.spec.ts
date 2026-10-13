// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors meta-ads.service.spec.ts: the `@lfx-one/shared/*` aliases are not wired into this app's
// vitest config with Angular-free resolution, so they are stubbed here. The constants come from the
// real source module by relative path rather than being retyped, so a spec can never pass against a
// catalogue or a limit the service does not actually use; `interfaces` contributes only types,
// which are erased.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => await import('../../../../../packages/shared/src/constants/campaign.constants'));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { DEFAULT_REDDIT_CALL_TO_ACTION, MAX_REDDIT_HEADLINE_LENGTH, REDDIT_CALL_TO_ACTIONS } from '@lfx-one/shared/constants';

import { buildRedditUtmUrl, executeRedditCampaignCreation, RedditApiError, redditOutcomeAmbiguous, resolveRedditAuthoredPost } from './reddit-ads.service';

describe('buildRedditUtmUrl — utm_campaign omission', () => {
  const config = {
    registrationUrl: 'https://events.linuxfoundation.org/kubecon-na-2026/',
    eventSlug: 'kubecon-na-2026',
    eventName: 'KubeCon NA 2026',
  } as Parameters<typeof buildRedditUtmUrl>[0];

  it('OMITS utm_campaign when HubSpot issued no token', () => {
    // Copilot: the omission landed on the Google Ads builder only, so attribution varied BY
    // PLATFORM for the same tokenless campaign -- honestly untagged on Google, falsely tagged on
    // Reddit. `hsToken || slug` minted a plausible-looking token HubSpot never issued, which is
    // indistinguishable downstream from a real one and attributes traffic to a campaign HubSpot
    // cannot report on. An absent parameter is visibly absent.
    const url = new URL(buildRedditUtmUrl({ ...config, hsToken: undefined }, 0));

    expect(url.searchParams.has('utm_campaign'), 'fabricated a utm_campaign from the event slug').toBe(false);
    // One parameter, not a refusal to tag: the rest still travels.
    expect(url.searchParams.get('utm_source')).toBe('reddit');
    expect(url.searchParams.get('utm_medium')).toBe('paid-social');
  });

  it('carries a real token through', () => {
    // The other direction, so the assertion above cannot be satisfied by dropping it always.
    const url = new URL(buildRedditUtmUrl({ ...config, hsToken: 'hs-real-token' }, 0));
    expect(url.searchParams.get('utm_campaign')).toBe('hs-real-token');
  });
});

// `resolveRedditAuthoredPost` is EXPORTED so these rules can be pinned directly, for the same
// reason `buildRedditUtmUrl` is: every one of them is a pure decision taken before the first
// upstream call, and asserting them through a full campaign create would exercise the dispatch
// plumbing instead of the rule. Each refusal below is a create that never reaches Reddit.
describe('resolveRedditAuthoredPost', () => {
  const base = {
    eventName: 'KubeCon NA 2026',
    eventSlug: 'kubecon-na-2026',
    registrationUrl: 'https://events.linuxfoundation.org/kubecon-na-2026/',
    variants: [],
  } as unknown as Parameters<typeof resolveRedditAuthoredPost>[0];

  const withImage = (overrides: Record<string, unknown> = {}) =>
    ({ ...base, imageUrl: 'https://cdn.example.com/kubecon.png', ...overrides }) as Parameters<typeof resolveRedditAuthoredPost>[0];

  describe('when no post is to be authored', () => {
    it('returns null when an existing post was named, even with an image alongside it', () => {
      // postUrl always wins, and the image is IGNORED rather than used to author a second post.
      // Both arms must agree, or the same request creates different things depending on which one
      // serves it.
      expect(resolveRedditAuthoredPost(withImage(), 't3_abc123')).toBeNull();
    });

    it('returns null when no image was given', () => {
      expect(resolveRedditAuthoredPost(base, undefined)).toBeNull();
    });

    it('treats a whitespace-only image URL as absent rather than invalid', () => {
      // A blank field is "the operator did not ask for a post", not "the operator gave a bad URL" —
      // refusing it would break every campaign created without an image, which is most of them.
      expect(resolveRedditAuthoredPost(withImage({ imageUrl: '   ' }), undefined)).toBeNull();
    });
  });

  describe('call to action', () => {
    it('defaults to the shared default when none was given', () => {
      expect(resolveRedditAuthoredPost(withImage(), undefined)?.callToAction).toBe(DEFAULT_REDDIT_CALL_TO_ACTION);
    });

    it('canonicalizes case to the catalogue spelling Reddit accepts', () => {
      // Read off the real catalogue rather than retyped, so this cannot pass against a spelling the
      // service does not actually offer. Reddit rejects any other casing, so a lowercase value an
      // operator typed has to be sent back in the catalogue's own form.
      const known = REDDIT_CALL_TO_ACTIONS[0];
      const resolved = resolveRedditAuthoredPost(withImage({ callToAction: known.toLowerCase() }), undefined);

      expect(resolved?.callToAction).toBe(known);
    });

    it('refuses an unknown call to action and names the accepted set', () => {
      // The operator cannot see the catalogue, so a refusal that only says "invalid" leaves them
      // guessing. The message carries the whole set.
      expect(() => resolveRedditAuthoredPost(withImage({ callToAction: 'Smash That Button' }), undefined)).toThrow(/must be one of .*Learn More/);
    });
  });

  describe('headline', () => {
    it("takes the first variant's headline", () => {
      const resolved = resolveRedditAuthoredPost(withImage({ variants: [{ headline: 'Join us in Los Angeles' }, { headline: 'Second variant' }] }), undefined);

      // Only variant 0: one post carries one headline. The rest stay in `steps` for Ads Manager.
      expect(resolved?.headline).toBe('Join us in Los Angeles');
    });

    it('falls back to the event name when the first variant has none', () => {
      expect(resolveRedditAuthoredPost(withImage({ variants: [{ headline: '  ' }] }), undefined)?.headline).toBe(base.eventName);
    });

    it('accepts a headline exactly at the limit', () => {
      // The over-refusal direction is the dangerous one: a guard that refuses a headline Reddit
      // would have accepted blocks a create for no reason, so the boundary is pinned on both sides.
      const atLimit = 'a'.repeat(MAX_REDDIT_HEADLINE_LENGTH);

      expect(resolveRedditAuthoredPost(withImage({ variants: [{ headline: atLimit }] }), undefined)?.headline).toBe(atLimit);
    });

    it('refuses one character past the limit', () => {
      const tooLong = 'a'.repeat(MAX_REDDIT_HEADLINE_LENGTH + 1);

      expect(() => resolveRedditAuthoredPost(withImage({ variants: [{ headline: tooLong }] }), undefined)).toThrow(/too long/);
    });

    it('measures CODE POINTS, not UTF-16 units', () => {
      // Upstream counts with `utf8.RuneCountInString`, where an astral character is one unit; a JS
      // `.length` calls it two and would refuse a headline Reddit accepts. 200 emoji is 200 runes
      // upstream and 400 `.length` units here, so a `.length` guard fails this test and a
      // code-point guard passes it.
      const emojiHeadline = '🎉'.repeat(200);

      expect([...emojiHeadline].length).toBeLessThanOrEqual(MAX_REDDIT_HEADLINE_LENGTH);
      expect(emojiHeadline.length).toBeGreaterThan(MAX_REDDIT_HEADLINE_LENGTH);
      expect(resolveRedditAuthoredPost(withImage({ variants: [{ headline: emojiHeadline }] }), undefined)?.headline).toBe(emojiHeadline);
    });
  });

  describe('image URL', () => {
    it.each([
      ['a relative path', '/assets/kubecon.png'],
      ['a bare host', 'cdn.example.com/kubecon.png'],
      ['a non-http(s) scheme', 'ftp://cdn.example.com/kubecon.png'],
      ['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
      ['embedded credentials', 'https://user:secret@cdn.example.com/kubecon.png'],
    ])('refuses %s', (_label, imageUrl) => {
      // Reddit ingests and re-hosts `media_url` at create time — there is no upload step — so
      // anything it cannot fetch publicly has to be refused before a campaign exists.
      expect(() => resolveRedditAuthoredPost(withImage({ imageUrl }), undefined)).toThrow(/Invalid Reddit image URL/);
    });

    it('never echoes the rejected URL back in the message', () => {
      // The message reaches the browser and is persisted in the campaign's `steps`. A URL an
      // operator pasted can carry a signed-asset query string, so the refusal says what is wrong
      // without quoting the value.
      const secretish = 'https://user:secret@cdn.example.com/kubecon.png?sig=abc123';

      try {
        resolveRedditAuthoredPost(withImage({ imageUrl: secretish }), undefined);
        expect.unreachable('expected the credentialed URL to be refused');
      } catch (err) {
        const message = (err as Error).message;
        expect(message).not.toContain('secret');
        expect(message).not.toContain('abc123');
        expect(message).not.toContain('cdn.example.com');
      }
    });

    it('accepts a plain https URL and trims it', () => {
      expect(resolveRedditAuthoredPost(withImage({ imageUrl: '  https://cdn.example.com/kubecon.png  ' }), undefined)?.imageUrl).toBe(
        'https://cdn.example.com/kubecon.png'
      );
    });
  });
});

describe('redditOutcomeAmbiguous', () => {
  // The asymmetry is the whole point: calling an ambiguous outcome definite tells the operator to
  // author the post again, which is how a duplicate PAID post gets made. Calling a definite one
  // ambiguous costs a look in Ads Manager that finds nothing.
  it('is definite for a 4xx OTHER THAN 429 — Reddit rejected the request on the merits', () => {
    expect(redditOutcomeAmbiguous(new RedditApiError(400, 'POST', '/profiles/t2_x/posts', 'bad request'))).toBe(false);
    expect(redditOutcomeAmbiguous(new RedditApiError(422, 'POST', '/profiles/t2_x/posts', 'unprocessable'))).toBe(false);
  });

  it('is ambiguous for a 5xx — the error may have been raised after the write', () => {
    expect(redditOutcomeAmbiguous(new RedditApiError(500, 'POST', '/profiles/t2_x/posts', 'boom'))).toBe(true);
    expect(redditOutcomeAmbiguous(new RedditApiError(502, 'POST', '/profiles/t2_x/posts', 'gateway'))).toBe(true);
  });

  it('is ambiguous for a 429 — a shed request says nothing about whether the write committed', () => {
    // The one 4xx that is NOT a semantic rejection, and the reason this is not folded into the
    // `< 500` test above: Reddit throttles the ads API, so classifying a 429 as "nothing was
    // created" is a live path to a duplicate PAID post or ad, not a theoretical one.
    expect(redditOutcomeAmbiguous(new RedditApiError(429, 'POST', '/profiles/t2_x/posts', 'rate limited'))).toBe(true);
  });

  it('is ambiguous for anything below 400 — reaching a responder is not proof nothing committed', () => {
    // `fetch` follows redirects, so this should never arrive; it is pinned so a later switch to
    // `redirect: 'manual'` cannot silently start reporting a 3xx on a POST as a definite failure.
    expect(redditOutcomeAmbiguous(new RedditApiError(302, 'POST', '/profiles/t2_x/posts', 'found'))).toBe(true);
    expect(redditOutcomeAmbiguous(new RedditApiError(307, 'POST', '/profiles/t2_x/posts', 'temporary redirect'))).toBe(true);
  });

  it('is ambiguous when there is no status at all', () => {
    // A timeout, abort or DNS failure cannot say whether the request was ever sent, so it must not
    // be reported as "nothing was created".
    expect(redditOutcomeAmbiguous(new DOMException('The operation was aborted.', 'TimeoutError'))).toBe(true);
    expect(redditOutcomeAmbiguous(new Error('Reddit post creation returned no id'))).toBe(true);
    expect(redditOutcomeAmbiguous(undefined)).toBe(true);
  });
});

describe('RedditApiError', () => {
  it('keeps the response body in the message for the server log', () => {
    // The body is what makes a 400 diagnosable. It is the `steps` arms that must not carry it —
    // the message shape itself is unchanged from the plain Error this class replaced, so existing
    // callers reading `err.message` behave exactly as before.
    const err = new RedditApiError(400, 'POST', '/profiles/t2_x/posts', 'destination_url is invalid');

    expect(err.message).toBe('Reddit API POST /profiles/t2_x/posts → 400: destination_url is invalid');
    expect(err.status).toBe(400);
    expect(err).toBeInstanceOf(Error);
  });
});

/**
 * The create path end to end, mirroring `meta-ads.service.spec.ts`: a mocked `fetch`, and
 * assertions on WHICH upstream calls were issued and in what order. The rules that matter here are
 * ordering rules — which call happens before which, and what is left behind when one of them fails
 * — and those are invisible to a test that only inspects a return value.
 */
describe('executeRedditCampaignCreation — the authored post', () => {
  const ADS_API = 'https://ads-api.reddit.com/api/v3';
  let fetchMock: ReturnType<typeof vi.fn>;

  /** Every ads-API path POSTed, in call order. The token refresh is not an ads-API call. */
  const postPaths = (): string[] =>
    fetchMock.mock.calls
      .filter((c) => (c[1] as RequestInit)?.method === 'POST' && String(c[0]).startsWith(ADS_API))
      .map((c) => String(c[0]).slice(ADS_API.length));

  /** The POST body sent to the ads-API path ending in `pathFragment`. Matched on the path, not the
   * whole URL: the host is `ads-api.reddit.com`, so `includes('/ads')` would match every call. */
  const bodyOf = <T>(pathFragment: string): T => {
    const call = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit)?.method === 'POST' && String(c[0]).startsWith(ADS_API) && String(c[0]).slice(ADS_API.length).endsWith(pathFragment)
    );
    return JSON.parse(String((call?.[1] as RequestInit)?.body ?? '{}'));
  };

  /**
   * Fail every ads-API request whose PATH contains `failPath` with `status`; succeed everything
   * else. Matched on the path rather than the whole URL because the host is `ads-api.reddit.com` —
   * a naive `includes('/ads')` matches every call there is.
   */
  /**
   * Fail the ads-API path(s) `failPath` selects, and succeed everything else. A string matches on
   * substring; a predicate is for the cases substring matching cannot express — every call in this
   * service sits under `/ad_accounts/<id>`, so only a predicate can single out the account GET.
   */
  function stubFetch(failPath?: string | ((path: string) => boolean), status = 500, failBody = 'rejected'): void {
    const fails = (path: string): boolean => (typeof failPath === 'function' ? failPath(path) : !!failPath && path.includes(failPath));
    let idCounter = 0;
    fetchMock = vi.fn(async (url: string) => {
      const path = String(url).startsWith(ADS_API) ? String(url).slice(ADS_API.length) : '';
      if (fails(path)) {
        return { ok: false, status, json: async () => ({}), text: async () => failBody };
      }
      return {
        ok: true,
        status: 200,
        // One shape serves both the token refresh and the ads API; neither reads the other's keys.
        json: async () => ({ access_token: 'test-token', expires_in: 3600, data: { id: `id-${++idCounter}` } }),
        text: async () => '',
      };
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  /**
   * Succeed every call, but answer the ads-API path containing `idlessPath` with a 2xx carrying no
   * `data.id`. Separate from `stubFetch` because this is NOT a failure: `resp.ok` is true and no
   * error is thrown, which is exactly what makes the case easy to drop on the floor.
   */
  function stubFetchWithoutId(idlessPath: string): void {
    let idCounter = 0;
    fetchMock = vi.fn(async (url: string) => {
      const path = String(url).startsWith(ADS_API) ? String(url).slice(ADS_API.length) : '';
      const data = path.includes(idlessPath) ? {} : { id: `id-${++idCounter}` };
      return { ok: true, status: 200, json: async () => ({ access_token: 'test-token', expires_in: 3600, data }), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  const config = (overrides: Record<string, unknown> = {}) =>
    ({
      eventName: 'KubeCon NA 2026',
      eventSlug: 'kubecon-na-2026',
      registrationUrl: 'https://events.linuxfoundation.org/kubecon-na-2026/',
      hsToken: 'hs-token',
      budgetUsd: 500,
      startDate: '2099-09-01',
      endDate: '2099-09-30',
      geoTargets: ['US'],
      keywords: ['kubernetes'],
      interests: [],
      subreddits: [],
      variants: [{ headline: 'Join us in Los Angeles' }],
      imageUrl: 'https://cdn.example.com/kubecon.png',
      ...overrides,
    }) as Parameters<typeof executeRedditCampaignCreation>[1];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['REDDIT_CLIENT_ID'] = 'test-id';
    process.env['REDDIT_CLIENT_SECRET'] = 'test-secret';
    process.env['REDDIT_REFRESH_TOKEN'] = 'test-refresh';
    stubFetch();
  });

  it('authors the post immediately before the ad that consumes it', async () => {
    const result = await executeRedditCampaignCreation(undefined, config());

    // The ordering IS the mitigation. Legacy keeps campaign → ad group → post → ad (rather than
    // upstream's post-first order, which rests on a claim/idempotency layer legacy does not have),
    // so the window in which an authored post exists with no ad attached is as short as it can be.
    expect(postPaths()).toEqual([
      '/ad_accounts/t2_gv9wtbfa/campaigns',
      '/ad_accounts/t2_gv9wtbfa/ad_groups',
      '/profiles/t2_gv9wtbfa/posts',
      '/ad_accounts/t2_gv9wtbfa/ads',
    ]);
    expect(result.adCount).toBe(1);
  });

  it('sends the post body Reddit expects, with the ad click URL as its destination', async () => {
    await executeRedditCampaignCreation(undefined, config());
    const post = bodyOf<{
      data: { type: string; headline: string; allow_comments: boolean; content: { media_url: string; call_to_action: string; destination_url: string }[] };
    }>('/posts');
    const ad = bodyOf<{ data: { click_url: string } }>('/ads');

    expect(post.data.type).toBe('IMAGE');
    expect(post.data.headline).toBe('Join us in Los Angeles');
    expect(post.data.allow_comments).toBe(false);
    expect(post.data.content[0].media_url).toBe('https://cdn.example.com/kubecon.png');
    expect(post.data.content[0].call_to_action).toBe(DEFAULT_REDDIT_CALL_TO_ACTION);
    // The post and the ad promoting it must send traffic to the SAME tagged URL, or the campaign
    // reports under two different destinations.
    expect(post.data.content[0].destination_url).toBe(ad.data.click_url);
  });

  it('promotes the named post and authors nothing when a post URL was given', async () => {
    const result = await executeRedditCampaignCreation(undefined, config({ postUrl: 'https://redd.it/abc123' }));

    expect(postPaths()).not.toContain('/profiles/t2_gv9wtbfa/posts');
    expect(result.steps.some((s) => s.startsWith('Extracted post ID: t3_abc123'))).toBe(true);
    expect(result.adCount).toBe(1);
  });

  it('refuses a bad image before ANY upstream call', async () => {
    // The load-bearing assertion is the second one: a refusal raised after the campaign POST would
    // leave a real campaign behind, which is the defect upstream moved these same checks to avoid.
    await expect(executeRedditCampaignCreation(undefined, config({ imageUrl: '/assets/relative.png' }))).rejects.toThrow(/Invalid Reddit image URL/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * Same load-bearing assertion as the image case above, for the same reason: `video_views` has no
   * static optimization goal, and a request that names the objective without a usable `videoGoal`
   * has to be refused before the campaign POST rather than after one exists in PAUSED (#3449).
   * Nothing in the Implementation tab collects a goal yet, so this is every `video_views` request
   * reaching this creator today, not an edge case.
   */
  it('refuses video_views with no usable goal before ANY upstream call', async () => {
    await expect(executeRedditCampaignCreation(undefined, config({ objective: 'video_views' }))).rejects.toThrow(/must be one of VIDEO_VIEW_6S/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The campaign and its ad group must agree: Reddit rejects an ad group whose goal differs from
   * its campaign's, and the two bodies are built in separate places, so one value reaching only
   * one of them is a live failure mode rather than a hypothetical one.
   */
  it('sends the requested video goal on both the campaign and its ad group', async () => {
    await executeRedditCampaignCreation(undefined, config({ objective: 'video_views', videoGoal: 'VIDEO_VIEW_15S' }));

    expect(bodyOf<{ data: { objective: string; optimization_goal: string } }>('/campaigns').data).toMatchObject({
      objective: 'VIDEO_VIEWABLE_IMPRESSIONS',
      optimization_goal: 'VIDEO_VIEW_15S',
    });
    expect(bodyOf<{ data: { optimization_goal: string } }>('/ad_groups').data.optimization_goal).toBe('VIDEO_VIEW_15S');
  });

  /**
   * Upstream's first branch is `if objective == ""`, so an empty objective is ABSENT there, not
   * invalid. Pinned because the obvious `??` spelling does not express it — it would pass `''`
   * through to the unsupported-objective refusal and reject a create upstream accepts. Reachable:
   * `POST /api/campaigns/create` forwards `redditConfig` without validating `objective`.
   */
  it.each([undefined, ''])('falls back to the default objective when the request carries %s', async (objective) => {
    await executeRedditCampaignCreation(undefined, config({ objective }));

    // DEFAULT_REDDIT_OBJECTIVE is `conversions`, whose table goal is PURCHASE.
    expect(bodyOf<{ data: { objective: string; optimization_goal: string } }>('/campaigns').data).toMatchObject({
      objective: 'CONVERSIONS',
      optimization_goal: 'PURCHASE',
    });
  });

  /**
   * The other half of that branch, and the reason `||` is not the spelling either: upstream decodes
   * `objective` into a Go string, so a non-string refuses at decode and never reaches
   * `CreateCampaign`. `||` would read these as absent and quietly create a budgeted `conversions`
   * campaign instead — an under-refusal, the mirror of the `??` over-refusal above. Reachable by
   * the same unvalidated route.
   */
  it.each([false, 0])('refuses the non-string objective %s rather than defaulting', async (objective) => {
    await expect(executeRedditCampaignCreation(undefined, config({ objective }))).rejects.toThrow(/Unsupported Reddit objective/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** The other three objectives keep taking the goal the table carries. */
  it('sends the table goal for an objective that has one', async () => {
    await executeRedditCampaignCreation(undefined, config({ objective: 'traffic' }));

    expect(bodyOf<{ data: { optimization_goal: string } }>('/campaigns').data.optimization_goal).toBe('CLICKS');
    expect(bodyOf<{ data: { optimization_goal: string } }>('/ad_groups').data.optimization_goal).toBe('CLICKS');
  });

  describe('when the post cannot be authored', () => {
    it('warns that a duplicate is possible after an ambiguous failure, and attaches no ad', async () => {
      stubFetch('/posts', 500);

      const result = await executeRedditCampaignCreation(undefined, config());

      expect(postPaths()).not.toContain('/ad_accounts/t2_gv9wtbfa/ads');
      expect(result.adCount).toBe(0);
      const step = result.steps.find((s) => s.includes('UNCONFIRMED'));
      expect(step).toContain('HTTP 500');
      expect(step).toContain('BEFORE authoring the post again');
    });

    it('states plainly that nothing was created after a 4xx', async () => {
      // Only a 4xx proves it: Reddit received the request and rejected it. Telling the operator to
      // check for a duplicate here would be noise; telling them so after a 5xx is the whole point.
      stubFetch('/posts', 400);

      const result = await executeRedditCampaignCreation(undefined, config());
      const step = result.steps.find((s) => s.startsWith('Promoted post authoring failed'));

      expect(step).toContain('No post was created');
      expect(result.steps.some((s) => s.includes('UNCONFIRMED'))).toBe(false);
    });

    it('does not tell the operator to author the post again when Reddit throttled the create', async () => {
      // A 429 is Reddit shedding the request, not rejecting it — the post may already exist. The
      // "create it again" wording here is what authors a second PAID post.
      stubFetch('/posts', 429, 'rate limited');

      const result = await executeRedditCampaignCreation(undefined, config());
      const step = result.steps.find((s) => s.includes('Promoted post authoring UNCONFIRMED'));

      expect(step).toContain('HTTP 429');
      expect(step).toContain('BEFORE authoring the post again');
      expect(result.steps.some((s) => s.startsWith('Promoted post authoring failed'))).toBe(false);
      expect(result.adCount).toBe(0);
    });

    it('does not say "no response from Reddit" when Reddit answered 2xx with no post id', async () => {
      // The outcome is genuinely ambiguous — a post may exist — so the UNCONFIRMED arm is right.
      // What would be false is the parenthetical: Reddit responded, and with a success status.
      stubFetchWithoutId('/posts');

      const result = await executeRedditCampaignCreation(undefined, config());
      const step = result.steps.find((s) => s.includes('Promoted post authoring UNCONFIRMED'));

      expect(step).toContain('Reddit accepted the request but returned no id');
      expect(step).not.toContain('no response from Reddit');
      expect(step).toContain('BEFORE authoring the post again');
      expect(postPaths()).not.toContain('/ad_accounts/t2_gv9wtbfa/ads');
      expect(result.adCount).toBe(0);
    });

    it('never writes the Reddit error body into the persisted steps', async () => {
      // `steps` is an operator-facing narrative that is returned to the browser and persisted with
      // the campaign. An upstream error body is none of those things: it is up to 400 characters of
      // whatever Reddit chose to return, including the request fields it echoes back. The status is
      // what the operator can act on; the body stays in the log line, where a 400 gets diagnosed.
      //
      // NOT a secrecy claim about the tagged URL — the manual-instructions step below deliberately
      // prints that URL, token and all, because the operator needs it to build the ad by hand.
      stubFetch('/posts', 400, 'INVALID: destination_url rejected by policy check 7731');

      const result = await executeRedditCampaignCreation(undefined, config());

      expect(result.steps.join('\n')).not.toContain('policy check 7731');
      expect(result.steps.join('\n')).not.toContain('rejected by');
    });
  });

  it('names the stray post when the ad is DEFINITELY not created after the post was authored', async () => {
    // Whether an ads-API post is feed-distributed is undocumented by Reddit, so an unattached post
    // is treated as a stray for the operator to clean up — and they cannot clean up a post id the
    // step never tells them. Only a 4xx licenses the flat "is now unattached".
    stubFetch('/ads', 400);

    const result = await executeRedditCampaignCreation(undefined, config());
    const step = result.steps.find((s) => s.startsWith('Ad creation failed'));

    expect(step).toContain('HTTP 400');
    expect(step).toMatch(/A promoted post was authored for this campaign \(id-\d+\) and is now unattached/);
    expect(result.adCount).toBe(0);
  });

  it('warns that a duplicate AD is possible when the ad create fails ambiguously', async () => {
    // The same rule as the post arm, with the same consequence one level down: a 5xx may have been
    // raised after the ad was written, so telling the operator to add the ad by hand is how a
    // second ad gets made — and both go live the moment the paused campaign is activated.
    stubFetch('/ads', 500);

    const result = await executeRedditCampaignCreation(undefined, config());
    const step = result.steps.find((s) => s.startsWith('Ad creation UNCONFIRMED'));

    expect(step).toContain('HTTP 500');
    expect(step).toContain('BEFORE adding an ad, to avoid creating a duplicate');
    expect(result.adCount).toBe(0);
  });

  it('does not tell the operator to add the ad by hand when Reddit throttled the ad create', async () => {
    // Same classification one level down, and the worse consequence: two ads in one paused ad
    // group both go live the moment the campaign is activated.
    stubFetch('/ads', 429, 'rate limited');

    const result = await executeRedditCampaignCreation(undefined, config());
    const step = result.steps.find((s) => s.startsWith('Ad creation UNCONFIRMED'));

    expect(step).toContain('HTTP 429');
    expect(step).toContain('BEFORE adding an ad, to avoid creating a duplicate');
    expect(result.steps.some((s) => s.startsWith('Ad creation failed'))).toBe(false);
    expect(result.adCount).toBe(0);
  });

  it('does not assert the post is unattached when the ad outcome is ambiguous', async () => {
    // If the 500 was raised after the write, the ad exists and the post is attached to it. Saying
    // "is now unattached" there sends the operator to delete a post that is in fact serving.
    stubFetch('/ads', 500);

    const result = await executeRedditCampaignCreation(undefined, config());
    const step = result.steps.find((s) => s.startsWith('Ad creation UNCONFIRMED'));

    expect(step).toMatch(/A promoted post was authored for this campaign \(id-\d+\) and may now be unattached/);
    expect(step).not.toContain('is now unattached');
  });

  it('says nothing about a stray when no post was authored here', async () => {
    // The operator's own post is not a stray — nothing happened to it, and telling them to delete
    // it would be telling them to delete something this create did not make.
    stubFetch('/ads', 400);

    const result = await executeRedditCampaignCreation(undefined, config({ postUrl: 'https://redd.it/abc123' }));

    expect(result.steps.find((s) => s.startsWith('Ad creation failed'))).not.toContain('unattached');
  });

  it('never writes the Reddit error body into the steps on the ad arm either', async () => {
    // The sibling assertion on the post arm left this one unpinned: a future edit back to
    // `${errMsg}` here would have stayed green.
    stubFetch('/ads', 400, 'INVALID: click_url rejected by policy check 7731');

    const result = await executeRedditCampaignCreation(undefined, config());

    expect(result.steps.join('\n')).not.toContain('policy check 7731');
    expect(result.steps.join('\n')).not.toContain('rejected by');
  });

  it('reports a failed account verification by status, without the body', async () => {
    // Exact match: every other call in this service also starts `/ad_accounts/t2_gv9wtbfa`.
    stubFetch((p) => p === '/ad_accounts/t2_gv9wtbfa', 500, 'upstream said something long and reflective');

    const result = await executeRedditCampaignCreation(undefined, config());
    const step = result.steps.find((s) => s.startsWith('Account verification warning'));

    expect(step).toContain('HTTP 500');
    expect(result.steps.join('\n')).not.toContain('reflective');
  });

  it('reports an ad create that returned 2xx with no ad id, and names the stray post', async () => {
    // Reddit accepted the call, so this is not a failure — but an ad with no id cannot be reported,
    // toggled or found, and the post authored a moment earlier is left unattached. Silence here is
    // the worst outcome: the operator adds an ad by hand and ends up with two.
    stubFetchWithoutId('/ads');

    const result = await executeRedditCampaignCreation(undefined, config());
    const step = result.steps.find((s) => s.includes('Ad creation UNCONFIRMED'));

    expect(step).toContain('Reddit accepted the request but returned no ad id');
    expect(step).toContain('to avoid creating a duplicate');
    // "may", not "is": Reddit accepted the call, so an ad may exist with this post attached to it.
    expect(step).toMatch(/A promoted post was authored for this campaign \(id-\d+\) and may now be unattached/);
    expect(result.adCount).toBe(0);
  });

  it('does not claim no image URL was provided when one was and the authoring failed', async () => {
    // Reachable with no variants because the headline falls back to the event name. The authoring
    // step above already said the image URL was supplied and the post failed; the older unconditional
    // wording contradicted it in the very next line.
    stubFetch('/posts', 500);

    const result = await executeRedditCampaignCreation(undefined, config({ variants: [] }));

    expect(result.steps).toContain('No ad variants, and no ad was attached — add ads manually in Reddit Ads Manager');
    expect(result.steps.join('\n')).not.toContain('post URL or image URL provided');
  });

  it('still says no image URL was provided when none was', async () => {
    stubFetch();

    const result = await executeRedditCampaignCreation(undefined, config({ variants: [], imageUrl: undefined }));

    expect(result.steps).toContain('No ad variants, post URL or image URL provided — add ads manually in Reddit Ads Manager');
  });
});
