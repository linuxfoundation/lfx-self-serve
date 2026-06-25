// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Marketing OS Agents catalog (LFXAI-95 workstream). The shared catalog drives
// both the marketplace tile grid and the per-agent chat surface, so it lives in
// @lfx-one/shared and is consumed by the Angular app and the Express proxy.

/**
 * Catalog status of a Marketing OS agent.
 * - `active`: backed by a live Guild agent (has `guildAgentHandle`); tile is clickable.
 * - `coming-soon`: placeholder tile with no live Guild agent yet; rendered disabled.
 */
export type MktgAgentStatus = 'active' | 'coming-soon';

/**
 * A Marketing OS agent surfaced in the marketplace.
 *
 * The server never trusts a client-supplied handle: it looks the agent up by
 * `id` in the shared catalog and uses the catalog's `guildAgentHandle` for
 * routing, so the Guild routing target can never be spoofed from the browser.
 */
export interface MktgAgent {
  /** Stable client-side identifier sent to the proxy as `agentId`. */
  id: string;
  /** Display ordering / badge number from the marketplace mockup. */
  number: number;
  /** Human-readable agent name. */
  name: string;
  /** Short capability chips shown on the tile and chat header. */
  tags: string[];
  /** Catalog status; gates whether the tile is clickable. */
  status: MktgAgentStatus;
  /** One-paragraph description shown on the tile and chat header. */
  description: string;
  /** Font Awesome icon class for the tile (e.g. `fa-light fa-landmark`). */
  icon: string;
  /**
   * Guild agent routing handle. When set, the server prepends `@${handle} ` to
   * outbound messages so Guild routes them to this agent. Omitted for
   * `coming-soon` agents that have no live Guild agent yet.
   */
  guildAgentHandle?: string;
}
