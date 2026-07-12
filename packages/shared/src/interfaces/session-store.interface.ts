// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Cookie metadata express-openid-connect attaches to a stored session entry — mirrors the cookie's own expiry so a custom store can derive a matching TTL. */
export interface SessionStoreCookieMeta {
  expires: number;
  maxAge: number;
}

/** Mirrors express-openid-connect's own (unexported) `Session` interface — the default `data` shape stored under `req.appSession`, plus whatever extra JWTs/context we add (impersonation, API-gateway, crowdfunding, profile). */
export interface AppSessionData {
  id_token: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string;
  [key: string]: unknown;
}

/** Shape express-openid-connect passes to a custom `session.store`'s `get`/`set` — the session data plus the header/cookie metadata used to determine expiry. Structurally compatible with the library's own (unexported) `SessionStorePayload` type. */
export interface SessionStorePayload<Data = AppSessionData> {
  header: {
    /** Timestamp (seconds) when the session was created. */
    iat: number;
    /** Timestamp (seconds) when the session was last touched. */
    uat: number;
    /** Timestamp (seconds) when the session expires. */
    exp: number;
  };
  data: Data;
  cookie: SessionStoreCookieMeta;
}
