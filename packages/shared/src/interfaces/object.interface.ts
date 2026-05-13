// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Built-in object types that should be passed through `NullifyEmptyStrings`
 * unchanged. Without this exclusion, the mapped-object branch would rebuild
 * them into bare records and lose their prototype.
 */
type PreservedObjectTypes = Date | Map<unknown, unknown> | Set<unknown> | URL | RegExp;

/**
 * Maps `T` so every nested `string` becomes `string | null`. Arrays map
 * elementwise, plain objects map each property, and {@link PreservedObjectTypes}
 * and functions are returned as-is. Implemented as a chain of single-conditional
 * aliases to avoid nested ternary expressions.
 */
export type NullifyEmptyStrings<T> = NullifyStringBranch<T>;

type NullifyStringBranch<T> = T extends string ? string | null : NullifyFunctionBranch<T>;
type NullifyFunctionBranch<T> = T extends (...args: any[]) => any ? T : NullifyPreservedBranch<T>;
type NullifyPreservedBranch<T> = T extends PreservedObjectTypes ? T : NullifyArrayBranch<T>;
type NullifyArrayBranch<T> = T extends readonly (infer U)[] ? NullifyEmptyStrings<U>[] : NullifyObjectBranch<T>;
type NullifyObjectBranch<T> = T extends object ? { [K in keyof T]: NullifyEmptyStrings<T[K]> } : T;
