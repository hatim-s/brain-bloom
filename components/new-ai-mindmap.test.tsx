// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIMindmapInput } from "./new-ai-mindmap";

const actionMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/mindmap", () => ({
  createMindmapFromAI: actionMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

beforeEach(() => {
  actionMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
});

afterEach(cleanup);

describe("AIMindmapInput", () => {
  it("shows generic copy for an unexpected failure and re-enables generation", async () => {
    const user = userEvent.setup();
    actionMock.mockResolvedValue({
      ok: false,
      code: "generation-failed",
    });
    render(<AIMindmapInput />);

    await user.type(screen.getByRole("textbox"), "Plan a launch");
    await user.click(screen.getByRole("button", { name: "Grow the map" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Generation failed — try again."
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Grow the map",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("shows a known Convex generation error", async () => {
    const user = userEvent.setup();
    actionMock.mockResolvedValue({
      ok: false,
      code: "too-many-nodes",
    });
    render(<AIMindmapInput />);

    await user.type(screen.getByRole("textbox"), "Plan a launch");
    await user.click(screen.getByRole("button", { name: "Grow the map" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sprig generated too many nodes — try a narrower prompt."
    );
  });

  it("pushes to the new map before refreshing the shared layout", async () => {
    const user = userEvent.setup();
    actionMock.mockResolvedValue({
      ok: true,
      data: {
        mindmapId: "mindmaps:generated",
        publicId: "generated1",
      },
      error: null,
      rawOutput: "",
    });
    render(<AIMindmapInput />);

    await user.type(screen.getByRole("textbox"), "Plan a launch");
    await user.click(screen.getByRole("button", { name: "Grow the map" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/maps/generated1");
      expect(refreshMock).toHaveBeenCalledOnce();
    });
    expect(pushMock.mock.invocationCallOrder[0]).toBeLessThan(
      refreshMock.mock.invocationCallOrder[0]
    );
  });
});
