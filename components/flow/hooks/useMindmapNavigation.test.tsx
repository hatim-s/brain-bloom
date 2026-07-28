// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMindmapFixture } from "../testing/fixtures";
import { useMindmapNavigation } from "./useMindmapNavigation";

afterEach(cleanup);

/** Characterization — pins canvas keyboard actions before the P3 hook migration. */
describe("useMindmapNavigation", () => {
  it("moves left to the node returned by navigate", () => {
    const fixture = renderNavigationHook("right-a-child");

    dispatchKey({ key: "ArrowLeft" });

    expect(fixture.setActiveNode).toHaveBeenCalledWith("right-a");
  });

  it("moves right to the node returned by navigate", () => {
    const fixture = renderNavigationHook("left-a-child");

    dispatchKey({ key: "ArrowRight" });

    expect(fixture.setActiveNode).toHaveBeenCalledWith("left-a");
  });

  it("moves up to the node returned by navigate", () => {
    const fixture = renderNavigationHook("left-b");

    dispatchKey({ key: "ArrowUp" });

    expect(fixture.setActiveNode).toHaveBeenCalledWith("left-a");
  });

  it("moves down to the node returned by navigate", () => {
    const fixture = renderNavigationHook("right-a");

    dispatchKey({ key: "ArrowDown" });

    expect(fixture.setActiveNode).toHaveBeenCalledWith("right-b");
  });

  it("ignores arrow keys when there is no active node", () => {
    const fixture = renderNavigationHook(null);

    dispatchKey({ key: "ArrowLeft" });
    dispatchKey({ key: "ArrowRight" });
    dispatchKey({ key: "ArrowUp" });
    dispatchKey({ key: "ArrowDown" });

    expect(fixture.setActiveNode).not.toHaveBeenCalled();
  });

  it("adds a child with the active non-root node type and id on Tab", () => {
    const fixture = renderNavigationHook("left-a");

    dispatchKey({ key: "Tab" });

    expect(fixture.onAddNode).toHaveBeenCalledWith("left", "left-a");
  });

  it("does not add a child when the root is active on Tab", () => {
    const fixture = renderNavigationHook("root");

    dispatchKey({ key: "Tab" });

    expect(fixture.onAddNode).not.toHaveBeenCalled();
  });

  it("does not add a child when there is no active node on Tab", () => {
    const fixture = renderNavigationHook(null);

    dispatchKey({ key: "Tab" });

    expect(fixture.onAddNode).not.toHaveBeenCalled();
  });

  it("selects an active left node on Enter", () => {
    const fixture = renderNavigationHook("left-a");

    dispatchKey({ key: "Enter" });

    expect(fixture.setSelectedNode).toHaveBeenCalledWith("left-a");
  });

  it("does not select the root on Enter", () => {
    const fixture = renderNavigationHook("root");

    dispatchKey({ key: "Enter" });

    expect(fixture.setSelectedNode).not.toHaveBeenCalled();
  });

  it("selects an active right node on Space", () => {
    const fixture = renderNavigationHook("right-a");

    dispatchKey({ key: " " });

    expect(fixture.setSelectedNode).toHaveBeenCalledWith("right-a");
  });

  it("does not select the root on Space", () => {
    const fixture = renderNavigationHook("root");

    dispatchKey({ key: " " });

    expect(fixture.setSelectedNode).not.toHaveBeenCalled();
  });

  it("starts AI editing and clears selection on Meta+k", () => {
    const fixture = renderNavigationHook("left-a");

    dispatchKey({ key: "k", metaKey: true });

    expect(fixture.setAiEditNode).toHaveBeenCalledWith("left-a");
    expect(fixture.setSelectedNode).toHaveBeenCalledWith(null);
  });

  it("starts AI editing and clears selection on Ctrl+k", () => {
    const fixture = renderNavigationHook("right-a");

    dispatchKey({ ctrlKey: true, key: "k" });

    expect(fixture.setAiEditNode).toHaveBeenCalledWith("right-a");
    expect(fixture.setSelectedNode).toHaveBeenCalledWith(null);
  });

  it("clears selection and AI editing on Escape", () => {
    const fixture = renderNavigationHook("right-a");

    dispatchKey({ key: "Escape" });

    expect(fixture.setSelectedNode).toHaveBeenCalledWith(null);
    expect(fixture.setAiEditNode).toHaveBeenCalledWith(null);
  });
});

/**
 * Renders the navigation hook with a fresh mindmap and independently observable callbacks.
 */
function renderNavigationHook(activeNode: string | null) {
  const { leveledNodes, nodesMap } = buildMindmapFixture();
  const setActiveNode = vi.fn<(nodeId: string | null) => void>();
  const onAddNode =
    vi.fn<(type: "left" | "right", parentNodeId: string) => void>();
  const setSelectedNode = vi.fn<(nodeId: string | null) => void>();
  const setAiEditNode = vi.fn<(nodeId: string | null) => void>();

  renderHook(() =>
    useMindmapNavigation({
      activeNode,
      setActiveNode,
      mindmapNodesMap: nodesMap,
      leveledNodes,
      onAddNode,
      setSelectedNode,
      setAiEditNode,
    })
  );

  return {
    setActiveNode,
    onAddNode,
    setSelectedNode,
    setAiEditNode,
  };
}

/** Dispatches a cancelable keydown event through the hook's real window listeners. */
function dispatchKey(init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ...init, cancelable: true })
    );
  });
}
