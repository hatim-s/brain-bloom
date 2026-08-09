import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { consumeConnectionRateBudget } from "./lib/connectionRateBudget";

/** Persists one owner/global endpoint attempt before the calling action continues. */
const consume = internalMutation({
  args: {
    subject: v.string(),
    endpoint: v.union(
      v.literal("createPendingCodex"),
      v.literal("selectDefaultCodex"),
      v.literal("list"),
      v.literal("getStatus")
    ),
  },
  handler: async (ctx, { subject, endpoint }) => {
    await consumeConnectionRateBudget(ctx, subject, endpoint);
  },
});

export { consume };
