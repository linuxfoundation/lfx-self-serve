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
