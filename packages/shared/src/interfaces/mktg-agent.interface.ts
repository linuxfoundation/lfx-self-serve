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
 * Tile accent color for the marketplace grid, named after an `lfxColors` scale.
 * The marketplace component maps each value to concrete Tailwind classes.
 */
export type MktgAgentAccent = 'blue' | 'emerald' | 'violet' | 'amber' | 'red' | 'gray';

/**
 * Presentation fields shared by every Marketing OS agent, independent of status.
 */
interface BaseMktgAgent {
  /** Stable client-side identifier sent to the proxy as `agentId`. */
  id: string;
  /** Display ordering / badge number from the marketplace mockup. */
  number: number;
  /** Human-readable agent name. */
  name: string;
  /** Short capability chips shown on the tile and chat header. */
  tags: string[];
  /** One-paragraph description shown on the tile and chat header. */
  description: string;
  /** Font Awesome icon class for the tile (e.g. `fa-light fa-landmark`). */
  icon: string;
  /** Tile accent color for the marketplace grid. Defaults to gray when unset. */
  accent?: MktgAgentAccent;
}

/** An agent backed by a live Guild agent: clickable tile, routable chat. */
export interface ActiveMktgAgent extends BaseMktgAgent {
  status: 'active';
  /**
   * Guild agent routing handle. The server prepends `@${handle} ` to outbound
   * messages so Guild routes them to this agent. Required for `active` agents.
   */
  guildAgentHandle: string;
}

/**
 * A placeholder tile with no live Guild agent yet: rendered disabled.
 * Has no `guildAgentHandle` property at all — `coming-soon` agents cannot carry
 * a routing handle (not even an explicit `undefined`).
 */
export interface ComingSoonMktgAgent extends BaseMktgAgent {
  status: 'coming-soon';
}

/**
 * A Marketing OS agent surfaced in the marketplace. Discriminated on `status`
 * so only `active` agents carry a `guildAgentHandle` — bad catalog entries
 * (an `active` agent with no handle, or a `coming-soon` agent with one) fail to
 * compile.
 *
 * The server never trusts a client-supplied handle: it looks the agent up by
 * `id` in the shared catalog and uses the catalog's `guildAgentHandle` for
 * routing, so the Guild routing target can never be spoofed from the browser.
 */
export type MktgAgent = ActiveMktgAgent | ComingSoonMktgAgent;
