// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface ChangelogViewUnseen {
  productId: string;
  unseenCount: number;
  lastViewedAt: string | null;
}

export interface ChangelogViewUnseenResponse {
  success: boolean;
  data: ChangelogViewUnseen;
}

export interface ChangelogViewMarkViewedData {
  productId: string;
  lastViewedAt: string;
}

export interface ChangelogViewMarkViewedResponse {
  success: boolean;
  data: ChangelogViewMarkViewedData;
}
