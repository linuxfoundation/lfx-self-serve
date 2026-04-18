// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Badge } from './badge.interface';

/** Raw Credly API badge entry as returned by GET /organizations/:orgId/badges */
export interface CredlyBadgeEntry {
  id: string;
  issued_at: string;
  issued_at_date: string;
  expires_at: string | null;
  expires_at_date: string | null;
  state: string;
  public: boolean;
  badge_url: string | null;
  accept_badge_url: string | null;
  recipient_email: string;
  image_url: string;
  issued_to: string;
  issued_to_first_name: string;
  issued_to_middle_name: string | null;
  issued_to_last_name: string;
  issuer_earner_id: string | null;
  user?: {
    first_name: string;
    middle_name: string | null;
    last_name: string;
    url: string;
  } | null;
  issuer?: {
    summary: string;
    entities: Array<{
      label: string;
      primary: boolean;
      entity: {
        type: string;
        id: string;
        name: string;
      };
    }>;
  } | null;
  badge_template?: {
    id: string;
    name: string;
    description: string;
    image_url: string;
    url: string;
    type_category: string | null;
    level: string | null;
    skills: string[];
    reporting_tags?: string[] | null;
  } | null;
}

/** Raw Credly API paginated response wrapper */
export interface CredlyApiResponse {
  data?: CredlyBadgeEntry[];
  metadata: {
    count: number;
    current_page: number;
    total_count: number;
    total_pages: number;
    per: number;
    previous_page_url: string | null;
    next_page_url: string | null;
  };
}

/** Cached Credly badge payload used by server-side in-memory cache. */
export interface CredlyCachedBadges {
  badges: Badge[];
  expiresAt: number;
}
