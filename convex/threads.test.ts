// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.ts"]);

/**
 * Creates an isolated thread-test harness with two authenticated users.
 */
function createHarness() {
  const t = convexTest(schema, modules);

  return {
    t,
    asAlice: t.withIdentity({ subject: "alice" }),
    asBob: t.withIdentity({ subject: "bob" }),
  };
}

describe("threads", () => {
  it("creates and lists threads in creation order", async () => {
    const { asAlice } = createHarness();
    const map = await asAlice.mutation(api.mindmaps.create, {
      name: "Thread map",
    });
    const firstId = await asAlice.mutation(api.threads.createThread, {
      mindmapId: map.mindmapId,
      title: "First",
    });
    const secondId = await asAlice.mutation(api.threads.createThread, {
      mindmapId: map.mindmapId,
      title: "Second",
    });

    const threads = await asAlice.query(api.threads.listThreads, {
      mindmapId: map.mindmapId,
    });

    expect(threads.map(({ _id, title }) => ({ _id, title }))).toEqual([
      { _id: firstId, title: "First" },
      { _id: secondId, title: "Second" },
    ]);
  });

  it("adds and lists opaque messages with operation linkage", async () => {
    const { asAlice } = createHarness();
    const map = await asAlice.mutation(api.mindmaps.create, {
      name: "Message map",
    });
    const operation = await asAlice.mutation(api.ops.apply, {
      mindmapId: map.mindmapId,
      ops: [],
      description: "AI reviewed the map",
      source: "ai",
    });
    const threadId = await asAlice.mutation(api.threads.createThread, {
      mindmapId: map.mindmapId,
      title: "Review",
    });
    const userMessageId = await asAlice.mutation(api.threads.addMessage, {
      threadId,
      role: "user",
      content: [{ type: "text", text: "Review this" }],
    });
    const assistantMessageId = await asAlice.mutation(api.threads.addMessage, {
      threadId,
      role: "assistant",
      content: [
        { type: "text", text: "Done" },
        { type: "data-operation", data: { seq: operation.seq } },
      ],
      operationId: operation.operationId,
    });

    const messages = await asAlice.query(api.threads.listMessages, {
      threadId,
    });

    expect(messages.map((message) => message._id)).toEqual([
      userMessageId,
      assistantMessageId,
    ]);
    expect(messages[0]).toMatchObject({
      mindmapId: map.mindmapId,
      role: "user",
      content: [{ type: "text", text: "Review this" }],
    });
    expect(messages[0].operationId).toBeUndefined();
    expect(messages[1]).toMatchObject({
      mindmapId: map.mindmapId,
      role: "assistant",
      operationId: operation.operationId,
    });
  });

  it("requires authentication for thread reads and writes", async () => {
    const { t, asAlice } = createHarness();
    const map = await asAlice.mutation(api.mindmaps.create, {
      name: "Private",
    });
    const threadId = await asAlice.mutation(api.threads.createThread, {
      mindmapId: map.mindmapId,
      title: "Private thread",
    });

    await expect(
      t.query(api.threads.listThreads, { mindmapId: map.mindmapId })
    ).rejects.toThrow("Unauthenticated");
    await expect(
      t.mutation(api.threads.createThread, {
        mindmapId: map.mindmapId,
        title: "Anonymous",
      })
    ).rejects.toThrow("Unauthenticated");
    await expect(
      t.query(api.threads.listMessages, { threadId })
    ).rejects.toThrow("Unauthenticated");
    await expect(
      t.mutation(api.threads.addMessage, {
        threadId,
        role: "user",
        content: "Anonymous",
      })
    ).rejects.toThrow("Unauthenticated");
  });

  it("forbids non-owner access to private threads", async () => {
    const { asAlice, asBob } = createHarness();
    const map = await asAlice.mutation(api.mindmaps.create, {
      name: "Private",
    });
    const threadId = await asAlice.mutation(api.threads.createThread, {
      mindmapId: map.mindmapId,
      title: "Private thread",
    });

    await expect(
      asBob.query(api.threads.listThreads, {
        mindmapId: map.mindmapId,
      })
    ).rejects.toThrow("Forbidden");
    await expect(
      asBob.mutation(api.threads.createThread, {
        mindmapId: map.mindmapId,
        title: "Not mine",
      })
    ).rejects.toThrow("Forbidden");
    await expect(
      asBob.query(api.threads.listMessages, { threadId })
    ).rejects.toThrow("Forbidden");
    await expect(
      asBob.mutation(api.threads.addMessage, {
        threadId,
        role: "user",
        content: "Not mine",
      })
    ).rejects.toThrow("Forbidden");
  });

  it("keeps shared-map threads and messages owner-only", async () => {
    const { t, asAlice, asBob } = createHarness();
    const map = await asAlice.mutation(api.mindmaps.create, {
      name: "Shared",
    });
    const threadId = await asAlice.mutation(api.threads.createThread, {
      mindmapId: map.mindmapId,
      title: "Shared thread",
    });
    await asAlice.mutation(api.threads.addMessage, {
      threadId,
      role: "assistant",
      content: { type: "text", text: "Visible" },
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("mindmaps", map.mindmapId, {
        visibility: "shared",
      });
    });

    await expect(
      asBob.query(api.threads.listThreads, {
        mindmapId: map.mindmapId,
      })
    ).rejects.toThrow("Forbidden");
    await expect(
      asBob.query(api.threads.listMessages, {
        threadId,
      })
    ).rejects.toThrow("Forbidden");
    await expect(
      asBob.mutation(api.threads.addMessage, {
        threadId,
        role: "user",
        content: "Cannot write",
      })
    ).rejects.toThrow("Forbidden");
  });

  it("validates that a linked operation belongs to the thread mindmap", async () => {
    const { t, asAlice } = createHarness();
    const firstMap = await asAlice.mutation(api.mindmaps.create, {
      name: "First",
    });
    const secondMap = await asAlice.mutation(api.mindmaps.create, {
      name: "Second",
    });
    const threadId = await asAlice.mutation(api.threads.createThread, {
      mindmapId: firstMap.mindmapId,
      title: "First thread",
    });
    const otherOperation = await asAlice.mutation(api.ops.apply, {
      mindmapId: secondMap.mindmapId,
      ops: [],
      description: "Other map",
      source: "ai",
    });

    await expect(
      asAlice.mutation(api.threads.addMessage, {
        threadId,
        role: "assistant",
        content: "Wrong operation",
        operationId: otherOperation.operationId,
      })
    ).rejects.toThrow("Invalid op: operation belongs to another mindmap");

    await t.run(async (ctx) => {
      await ctx.db.delete("operations", otherOperation.operationId);
    });
    await expect(
      asAlice.mutation(api.threads.addMessage, {
        threadId,
        role: "assistant",
        content: "Missing operation",
        operationId: otherOperation.operationId,
      })
    ).rejects.toThrow("Not found");
  });
});
