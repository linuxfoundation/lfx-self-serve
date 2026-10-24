// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Display-only projection; email and opaque subjects never enter this response. */
export interface MktgAccessPerson {
  name: string;
  avatar?: string;
  username?: string;
  isExecutiveDirector: boolean;
}
export interface MktgAccessResponse {
  writers: MktgAccessPerson[];
  executiveDirector: MktgAccessPerson | null;
  warnings: string[];
}
