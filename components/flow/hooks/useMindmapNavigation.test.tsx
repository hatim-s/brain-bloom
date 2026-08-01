// @vitest-environment jsdom

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMindmapFixture } from "../testing/fixtures";
import { useMindmapNavigation } from "./useMindmapNavigation";

afterEach(cleanup);

/** Verifies canvas keyboard navigation and editing actions. */
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

  it.each(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])(
    "enters the map at the root on %s with no active node",
    (key) => {
      const fixture = renderNavigationHook(null);

      // Nothing is selected on a freshly loaded canvas until the reader clicks,
      // so an arrow key has to be a way *in*, not a no-op.
      dispatchKey({ key });

      expect(fixture.setActiveNode).toHaveBeenCalledWith("root");
    }
  );

  it("enters the map at the root when the active node has vanished", () => {
    const fixture = renderNavigationHook("deleted-by-a-reseed");

    dispatchKey({ key: "ArrowDown" });

    expect(fixture.setActiveNode).toHaveBeenCalledWith("root");
  });

  it("keeps arrow keys alive from a focused node card", () => {
    const fixture = createNavigationFixture("right-a-child");
    const view = render(
      <NavigationOnCanvasCard fixture={fixture} label="Right A child" />
    );
    const card = view.getByRole("button", { name: "Right A child" });
    card.focus();

    // A node card is a popover trigger, so clicking one parks focus on a
    // button. Navigation used to die there.
    const event = dispatchKeyOn(card, { key: "ArrowLeft" });

    expect(fixture.setActiveNode).toHaveBeenCalledWith("right-a");
    expect(event.defaultPrevented).toBe(true);
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

  it("clears selection and AI editing on Escape from a focused input", () => {
    const fixture = renderNavigationHook("right-a");
    const view = render(<input aria-label="Title" />);
    const input = view.getByRole("textbox");
    input.focus();

    dispatchKeyOn(input, { key: "Escape" });

    expect(fixture.setSelectedNode).toHaveBeenCalledWith(null);
    expect(fixture.setAiEditNode).toHaveBeenCalledWith(null);
  });

  it("leaves button activation and focus traversal native with canvas bindings mounted", () => {
    const fixture = createNavigationFixture("left-a");
    const view = render(<NavigationWithButton fixture={fixture} />);
    const button = view.getByRole("button", { name: "Plain action" });
    button.focus();

    // Component-isolated keyboard tests hid an entire bug class: the real
    // window-level canvas bindings coexist with every control on the page.
    const enterEvent = dispatchKeyOn(button, { key: "Enter" });
    const tabEvent = dispatchKeyOn(button, { key: "Tab" });

    expect(fixture.setSelectedNode).not.toHaveBeenCalled();
    expect(fixture.onAddNode).not.toHaveBeenCalled();
    expect(enterEvent.defaultPrevented).toBe(false);
    expect(tabEvent.defaultPrevented).toBe(false);
  });

  it("keeps navigation but does not bind mutation keys in read-only mode", () => {
    const fixture = renderNavigationHook("left-a", true);

    dispatchKey({ key: "ArrowRight" });
    dispatchKey({ key: "Tab" });
    dispatchKey({ key: "Enter" });
    dispatchKey({ key: " " });
    dispatchKey({ key: "k", metaKey: true });

    expect(fixture.setActiveNode).toHaveBeenCalled();
    expect(fixture.onAddNode).not.toHaveBeenCalled();
    expect(fixture.setSelectedNode).not.toHaveBeenCalled();
    expect(fixture.setAiEditNode).not.toHaveBeenCalled();
  });
});

/**
 * Renders the navigation hook with a fresh mindmap and independently observable callbacks.
 */
function renderNavigationHook(activeNode: string | null, readOnly = false) {
  const fixture = createNavigationFixture(activeNode, readOnly);

  renderHook(() => useMindmapNavigation(fixture));

  return fixture;
}

/** Builds observable navigation inputs shared by hook and integration tests. */
function createNavigationFixture(activeNode: string | null, readOnly = false) {
  const { leveledNodes, nodesMap } = buildMindmapFixture();
  const setActiveNode = vi.fn<(nodeId: string | null) => void>();
  const onAddNode =
    vi.fn<(type: "left" | "right", parentNodeId: string) => void>();
  const setSelectedNode = vi.fn<(nodeId: string | null) => void>();
  const setAiEditNode = vi.fn<(nodeId: string | null) => void>();

  return {
    readOnly,
    activeNode,
    mindmapNodesMap: nodesMap,
    leveledNodes,
    setActiveNode,
    onAddNode,
    setSelectedNode,
    setAiEditNode,
  };
}

/** Mounts the real canvas bindings beside an ordinary page control. */
function NavigationWithButton({
  fixture,
}: {
  fixture: ReturnType<typeof createNavigationFixture>;
}) {
  useMindmapNavigation(fixture);
  return <button type="button">Plain action</button>;
}

/** Mounts the canvas bindings around a node card, XYFlow wrapper and all. */
function NavigationOnCanvasCard({
  fixture,
  label,
}: {
  fixture: ReturnType<typeof createNavigationFixture>;
  label: string;
}) {
  useMindmapNavigation(fixture);
  return (
    <div className="react-flow__node">
      <button type="button">{label}</button>
    </div>
  );
}

/** Dispatches a cancelable keydown event through the hook's real window listeners. */
function dispatchKey(init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ...init, cancelable: true })
    );
  });
}

/** Dispatches a bubbling keydown from an element so window sees its real target. */
function dispatchKeyOn(
  target: Element,
  init: KeyboardEventInit
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    ...init,
    bubbles: true,
    cancelable: true,
  });

  act(() => {
    target.dispatchEvent(event);
  });

  return event;
}
