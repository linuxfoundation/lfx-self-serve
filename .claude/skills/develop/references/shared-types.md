# Shared Types Reference

## Location

All shared types live in `packages/shared/src/`:

- **Interfaces:** `interfaces/<name>.interface.ts`
- **Enums:** `enums/<name>.enum.ts`
- **Constants:** `constants/<name>.constants.ts`

## Conventions

- License header required on all new files
- Prefer `interface` for shared object shapes; use `type` for literal unions and discriminated unions
- Use `as const` for constant objects to get literal types
- Export from the barrel file (`index.ts`) in the same directory
- Shared types used across modules belong in `@lfx-one/shared/interfaces` — purely local UI types (e.g., component-internal state) may be defined locally when they have no reuse potential

## File Naming

```text
packages/shared/src/
├── interfaces/
│   ├── my-feature.interface.ts    # TypeScript interfaces
│   └── index.ts                   # Barrel export
├── enums/
│   ├── my-feature.enum.ts         # Enumerations
│   └── index.ts
└── constants/
    ├── my-feature.constants.ts    # Constant objects with `as const`
    └── index.ts
```

## Usage

```typescript
import { MyInterface } from '@lfx-one/shared/interfaces';
import { MyEnum } from '@lfx-one/shared/enums';
import { MY_CONSTANT } from '@lfx-one/shared/constants';
```

## Checklist

- [ ] File has license header
- [ ] File uses correct suffix (`.interface.ts`, `.enum.ts`, `.constants.ts`)
- [ ] Exported from barrel `index.ts`
- [ ] Interfaces use `interface`, not `type` unions
- [ ] Constants use `as const` for literal types
