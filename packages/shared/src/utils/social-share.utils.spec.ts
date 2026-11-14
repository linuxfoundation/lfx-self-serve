// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildSocialShareHref, buildSocialShareLinks } from './social-share.utils';

const URL = 'https://app.lfx.dev/newsletters/cncf/abc123';
const ENCODED_URL = 'https%3A%2F%2Fapp.lfx.dev%2Fnewsletters%2Fcncf%2Fabc123';

describe('buildSocialShareHref', () => {
  it('builds the X intent with url and text', () => {
    expect(buildSocialShareHref('x', URL, 'Hello')).toBe(`https://x.com/intent/tweet?url=${ENCODED_URL}&text=Hello`);
  });

  it('builds the LinkedIn share-offsite URL with only the url', () => {
    expect(buildSocialShareHref('linkedin', URL, 'Hello')).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${ENCODED_URL}`);
  });

  it('builds the Reddit submit URL with url and title', () => {
    expect(buildSocialShareHref('reddit', URL, 'Hello')).toBe(`https://www.reddit.com/submit?url=${ENCODED_URL}&title=Hello`);
  });

  it('builds a mailto with the title as subject and title + url as body', () => {
    expect(buildSocialShareHref('email', URL, 'Hello')).toBe(`mailto:?subject=Hello&body=Hello%0A%0A${ENCODED_URL}`);
  });

  it('encodes reserved characters, spaces and emoji in the title', () => {
    const href = buildSocialShareHref('reddit', URL, 'Kids + Agents & PHP #1 🚀');
    expect(href).toBe(`https://www.reddit.com/submit?url=${ENCODED_URL}&title=Kids%20%2B%20Agents%20%26%20PHP%20%231%20%F0%9F%9A%80`);
  });
});

describe('buildSocialShareLinks', () => {
  it('returns X, LinkedIn, Reddit and email in display order with resolved hrefs', () => {
    const links = buildSocialShareLinks(URL, 'Hello');
    expect(links.map((l) => l.key)).toEqual(['x', 'linkedin', 'reddit', 'email']);
    expect(links[0].href).toBe(buildSocialShareHref('x', URL, 'Hello'));
    expect(links[3].href.startsWith('mailto:')).toBe(true);
  });
});
