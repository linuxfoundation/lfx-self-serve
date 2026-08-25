// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Marketing OS Agents catalog (LFXAI-95 workstream). The shared catalog drives
// both the marketplace tile grid and the per-agent run pages, so it lives in
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
  /**
   * Catalog agent ids whose stored output this agent CONSUMES
   * (dec-agent-dependency-gating). A dependent agent's marketplace card stays
   * disabled — labeled `Requires <dependency document>` — until every
   * dependency has stored output for the active project (server-persisted
   * preferred, browser-stored run fallback), and its intake auto-attaches the
   * dependency documents at submit time instead of asking for them.
   * Dependency handling is generic: nothing keys on a specific agent id.
   */
  dependsOn?: string[];
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

/**
 * One rendered marketplace card: a catalog agent plus everything the grid
 * template needs already decided. The presentation strings are precomputed
 * here rather than expressed in the template so the card's disabled state and
 * its accessible name are derived in one place and can never drift.
 */
export interface MktgAgentTile {
  /** The catalog entry this card renders. */
  agent: MktgAgent;
  /** Tailwind classes for the icon chip, resolved from the agent's accent. */
  iconClass: string;
  /** Tailwind classes for the card's left accent border. */
  borderClass: string;
  /** True when the card is inert: `coming-soon`, or missing a dependency. */
  disabled: boolean;
  /**
   * Document names of the dependencies with no stored output for the active
   * project (dec-agent-dependency-gating). Empty when nothing is missing —
   * including for `coming-soon` agents, which are disabled for their own
   * reason and never tagged as dependency-blocked.
   */
  missingDependencyNames: string[];
  /**
   * Accessible name for the card. Enabled cards announce the action ("Open
   * X"); disabled cards announce the agent plus WHY it is inert, so a
   * screen-reader user gets the same reason the visible tags carry.
   */
  ariaLabel: string;
}
