// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

declare global {
  namespace Express {
    interface Request {
      bearerToken?: string;
    }
  }
}

export {};
