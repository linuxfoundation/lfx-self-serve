# My CLA validation — SS (prod) vs EasyCLA Snowflake mirror

**Date:** 2026-08-07 · **Result: 20/20 users match exactly** — 306 CLA agreements compared field-by-field (kind, CLA group name, signedOn, documentVersion). No Self Serve defects found.

## Method

- **Actual side:** `GET /api/me/clas` captured on https://app.lfx.dev/ via impersonation of each target user (SS identity resolution is impersonation-aware — verified in `cla.service.ts`).
- **Expected side:** EasyCLA `/v4/my-clas` logic re-implemented against the raw Fivetran mirrors (`FIVETRAN_INGEST.DYNAMODB_PRODUCT_US_EAST_1.CLA_PROD_*`), with identity inputs from the Auth0 mirror. Raw ingest used deliberately — bronze models filter test CLA groups and drop needed columns.
- **Validity rules replicated:** user signatures (`signature_reference_type='user'`, type `cla`/`ecla`, signed); ICLA valid = approved; ECLA valid = approved + company record exists + not sanctioned + approved & signed CCLA for (claGroup, company) + user covered by the CCLA's current approval lists.

## Results

| Cohort | Users | Agreements | Verdict |
|---|---|---|---|
| Team | michal (3), ahmed.omosanya (1), HWillson (5), ddeal (4), jsarias (4) | 17 | ✅ all match |
| Top-5 by CLA count | pdebelen (88), georgegrant (84), jmertic (21), reiemp (9), kshitij12345 (8) | 210 | ✅ all match |
| Second cohort | electrocucaracha (7), pavan27 (7), valderrv (7), agrimberg (8), thc1006 (7), swinslow (5), jsoref (6), juanestrella (6), Impact-maker (5), DWTalton (4) | 62 | ✅ all match |

Cohort 2 was chosen for variety: mixed-case LFIDs (`Impact-maker`, `DWTalton`), users with no linked GitHub (`swinslow`, `Impact-maker`, `DWTalton`), a multi-record identity (`juanestrella`, 3 EasyCLA records), and a range of CLA counts.

Field-level normalizations applied before diffing (all rendering-only, confirmed against the API): documentVersion minor defaults to 0 upstream (`"2"` → `"2.0"`); signedOn compared at second precision UTC; empty-vs-null signedOn treated equal (~1.4% of legacy signatures lack dates).

## Two expected-side bugs found and fixed (in my harness, not in SS)

Both surfaced in cohort 2 as single-CLA deltas, and both were my replication being wrong about EasyCLA's real semantics:

1. **`swinslow` — missing-company ECLA.** My script only invalidated an ECLA when the company was *found and sanctioned*. EasyCLA's `company()` swallows `CompanyNotFound` into a `nil` model, and `eclaCoveredByCurrentApprovalList` rejects `companyModel == nil` outright. SS was right to hide it.
2. **`agrimberg` — non-GitHub linked-identity email.** My script harvested `profileData.email` only from GitHub identities. `collectClaEmails` harvests it from **every** linked identity; agrimberg's LinkedIn identity carries `grimbeaj@gmail.com`, which is the `lf_email` on a second EasyCLA record (`lf_username: tykeal`). SS correctly reached that record's CNCF ICLA.

After both fixes, the full 20-user set matches.

## EasyCLA data-quality findings (not SS bugs — worth routing to the EasyCLA team)

### 1. Orphaned ECLAs — 85 signatures pointing at deleted companies

85 approved+signed ECLAs reference 25 company IDs with no record in `CLA_PROD_COMPANIES`. EasyCLA correctly treats these as invalid, so SS hides them.

**Impact:** 12 users have *no other* approved signature, so their My CLA tab is empty despite having signed. 5 have an LFID; 3 of those exist in Auth0 and can actually log in. Verified live in prod — all 3 return `agreements: []`. (Affected LFIDs withheld from this public doc; available on request.)

### 2. Mixed-case `lf_email` records are unreachable

EasyCLA matches `lf_email` via an exact-match GSI, while the query email is lowercased, so a record stored as `First.Last@example.com` can never be matched. 410 user records have a mixed-case `lf_email`; 33 of those have no `lf_username` *and* carry approved signatures (465 signatures). 26 have a reachable twin record, leaving **7 genuinely stranded records holding 96 approved signatures** — one alone accounts for 86 of them, the rest hold 1–2 each.

Two of the seven map to real, loggable LFIDs. Verified live in prod: both return `matchedUserIds: 0, unmatched: true` — EasyCLA matches no user record at all, so their signed CLAs are invisible to them. (Specific addresses and LFIDs withheld from this public doc; available on request for the EasyCLA fix.)

**Suggested fix (EasyCLA side):** normalize `lf_email` to lowercase on write and backfill existing records, or lowercase the GSI key.

### 3. Duplicate user records (`pdebelen`)

4 EasyCLA user records for one person, with FINOS/Goldman Sachs ECLA coverage duplicated across three (87 + 86 + 86 signatures). SS shows the 88 from the two records EasyCLA's matching reaches. No user-facing loss — the unreachable ones duplicate coverage already shown — but it inflates signature counts and is worth deduping.

**Scale context:** 91,217 approved user signatures total, so each issue above affects well under 0.2%.

## Caveats

- Expected side reflects the Fivetran mirror at query time (freshness threshold 4 days); a signature created minutes before capture could diff — none did.
- ECLA `github_org_whitelist` coverage can't be evaluated offline; no tested CLA depended on it after matching.
- The expected-side email set approximates SS's auth-service verified-email list from the Auth0 mirror. This can only make the expected set *narrower* than SS's; since all 20 matched exactly, it did not mask anything here.
