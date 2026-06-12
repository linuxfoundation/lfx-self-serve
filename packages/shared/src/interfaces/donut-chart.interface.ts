// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface DonutRing {
  /** 0–100 percentage value */
  value: number;
  /** Solid color string */
  color: string;
}

export interface ResolvedDonutRing extends DonutRing {
  r: number;
  circumference: number;
  dash: number;
}
