// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Minimal Supabase user shape used by badge fallback flows. */
export interface SupabaseUser {
  id: string;
  username: string;
}

/**
 * Supabase email record used by badge email resolution.
 * Fields use snake_case to match the raw Supabase wire format.
 */
export interface SupabaseUserEmail {
  email: string;
  is_verified: boolean;
}
