/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiConnectionLifecycle from "../aiConnectionLifecycle.js";
import type * as aiConnections from "../aiConnections.js";
import type * as aiConnectionsInternal from "../aiConnectionsInternal.js";
import type * as connectionRateBudget from "../connectionRateBudget.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_connectionRateBudget from "../lib/connectionRateBudget.js";
import type * as lib_nodeOps from "../lib/nodeOps.js";
import type * as lib_personalBeta from "../lib/personalBeta.js";
import type * as migration from "../migration.js";
import type * as mindmaps from "../mindmaps.js";
import type * as ops from "../ops.js";
import type * as threads from "../threads.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiConnectionLifecycle: typeof aiConnectionLifecycle;
  aiConnections: typeof aiConnections;
  aiConnectionsInternal: typeof aiConnectionsInternal;
  connectionRateBudget: typeof connectionRateBudget;
  "lib/access": typeof lib_access;
  "lib/connectionRateBudget": typeof lib_connectionRateBudget;
  "lib/nodeOps": typeof lib_nodeOps;
  "lib/personalBeta": typeof lib_personalBeta;
  migration: typeof migration;
  mindmaps: typeof mindmaps;
  ops: typeof ops;
  threads: typeof threads;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
