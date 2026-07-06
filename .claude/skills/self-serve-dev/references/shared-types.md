<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Shared Types Reference

Canonical shared-package conventions (location, naming, barrel exports, when to share vs keep local, import aliases) live in [`docs/architecture/shared/package-architecture.md`](../../../docs/architecture/shared/package-architecture.md). Use that doc as the source of truth.

## Quick placement rules

- **Interfaces and type aliases** → `packages/shared/src/interfaces/<name>.interface.ts`.
- **Runtime values** (`const`, `as const` objects, `Set`s, arrays) → `packages/shared/src/constants/<name>.constants.ts`. Constants files export **values only — no `export type` / `export interface`**.
- **Derived type aliases belong with the interfaces, not the constant.** When you write `export type Foo = (typeof BAR)[keyof typeof BAR]`, define it in the matching `.interface.ts` and import the `BAR` constant into that file — even though `BAR` itself lives in `constants/`.
- Export every new file from its directory `index.ts` barrel, and import via the category path (`@lfx-one/shared/interfaces`, `@lfx-one/shared/constants`).

```typescript
// constants/events.constants.ts — value only
export const MY_EVENT_STATUS = { ATTENDED: 'Attended', REGISTERED: 'Registered' } as const;

// interfaces/events.interface.ts — derived alias
import { MY_EVENT_STATUS } from '../constants/events.constants';

export type MyEventStatus = (typeof MY_EVENT_STATUS)[keyof typeof MY_EVENT_STATUS];
```
