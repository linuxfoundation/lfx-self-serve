# Data model: Contact CLA Manager

**Feature**: [spec.md](./spec.md) | **Date**: 2026-08-20

No Self Serve persistence. Shapes below are request/response DTOs.

## ClaManagerRequestMode (UI)

`approval` | `removal` | `contact`

Copy key only. Not sent upstream.

## ClaManagerRequestType (wire)

`approval` | `removal`

BFF 400 on any other string, including `contact`.

## ClaManager (client)

| Field        | Source                | Notes                                             |
| ------------ | --------------------- | ------------------------------------------------- |
| `lfUsername` | producer `lfUsername` | Recipient key. Required. Skip entries without one |
| `name`       | producer `name`       | Optional; fall back to `lfUsername` in the list   |
| `email`      | producer `email`      | Optional; display not required                    |

## ClaManagerList (client)

| Field         | Source                                              |
| ------------- | --------------------------------------------------- |
| `signatureId` | producer `signatureID`                              |
| `managers`    | producer `managers` (always an array, may be empty) |
| `resultCount` | producer `resultCount`                              |

Other producer fields (`claGroupID`, `companyName`, `claManager`) are not required by the modal.

## ClaManagerRequest (browser → BFF)

```json
{
  "requestType": "approval",
  "recipients": ["jdoe", "asmith"],
  "message": "optional, max 4096"
}
```

`recipients` MUST be a non-empty array of non-empty strings. `message` omitted or trimmed empty is omitted upstream.

## ClaManagerRequestResult (BFF → browser)

| Field         | Source                 |
| ------------- | ---------------------- |
| `requestId`   | producer `requestID`   |
| `signatureId` | producer `signatureID` |
| `requestType` | producer `requestType` |
| `status`      | `sent` \| `recorded`   |
| `recipients`  | producer `recipients`  |

`sent`: at least one selected manager had a resolvable email. `recorded`: audit only.

## Modal config (DialogService data)

```ts
{
  signatureId: string;
  projectName: string;
  mode: ClaManagerRequestMode;
}
```

`projectName` is the My CLAs primary line (`projectName || claGroupName`) for v17 hint interpolation.

## Validation rules

| Rule                                           | Where |
| ---------------------------------------------- | ----- |
| `signatureId` UUID (hyphens optional)          | BFF   |
| `requestType` ∈ {approval, removal}            | BFF   |
| `recipients` non-empty, each trimmed non-empty | BFF   |
| `message` length ≤ 4096                        | BFF   |
| Contact Send never constructs this body        | UI    |
