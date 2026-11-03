// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** One agent in the IT OS catalog, shown as a card on the IT OS landing page. */
export interface ItOsAgent {
  /** Stable id, also the route segment of the agent's page (e.g. /project/it-os-agents/dns). */
  id: string;
  name: string;
  /** Font Awesome icon class. */
  icon: string;
  /** Brand colour scale for the card's icon tile (blue, emerald, amber, violet or gray). */
  color: string;
  tags: string[];
  /** The service the agent works through, shown as "via <service>". */
  via?: string;
  description: string;
  /** Listed but not available yet: rendered as a disabled "Coming soon" card. */
  comingSoon?: boolean;
}
