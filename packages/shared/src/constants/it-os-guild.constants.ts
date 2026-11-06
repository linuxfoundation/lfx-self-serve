// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Live IT OS agents on Guild (#4257). Only agents listed here can be reached through
// /api/it-os-agents; the others are still scripted demos in the browser.

/** IT OS agent id → Guild agent name (the workspace owner completes it as `owner~name`). */
export const IT_OS_GUILD_AGENTS: Readonly<Record<string, string>> = {
  domains: 'it-os-domains',
};

/** Longest chat message the route accepts. */
export const IT_OS_CHAT_MESSAGE_MAX_CHARS = 4000;

/** LFX project uids are a single path segment; checked before the uid reaches an upstream URL. */
export const IT_OS_PROJECT_UID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** How often the live chat checks for the agent's reply, and for how long, in milliseconds. */
export const IT_OS_LIVE_POLL_MS = 2500;
export const IT_OS_LIVE_MAX_WAIT_MS = 150_000;

/** Starter questions for the live Domains & DNS agent: read-only, so trying one changes nothing. */
export const IT_OS_LIVE_DNS_SUGGESTIONS = [
  'What domains does this project have?',
  'Show the DNS records for our domains',
  'What nameservers should our domains use?',
];

/** Sample data or the live agent, for agents that have one. */
export const IT_OS_CHAT_MODE_OPTIONS = [
  { label: 'Sample data', value: 'sample' },
  { label: 'Live (dev)', value: 'live' },
];
