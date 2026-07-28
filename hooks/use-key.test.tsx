// @vitest-environment jsdom

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useKey } from "./use-key";

afterEach(cleanup);

/** Verifies exact key, modifier, and editable-target matching. */
describe("useKey", () => {
  it("fires when the event key matches the binding", () => {
    const callback = vi.fn();
    renderHook(() => useKey("k", callback));

    dispatchKey({ key: "k" });

    expect(callback).toHaveBeenCalledOnce();
  });

  it("fires when the event code matches despite a different key value", () => {
    const callback = vi.fn();
    renderHook(() => useKey("k", callback));

    dispatchKey({ code: "KeyK", key: "different" });

    expect(callback).toHaveBeenCalledOnce();
  });

  it("does not fire when neither key nor code matches", () => {
    const callback = vi.fn();
    renderHook(() => useKey("k", callback));

    dispatchKey({ code: "KeyJ", key: "j" });

    expect(callback).not.toHaveBeenCalled();
  });

  it("fires a ctrl-or-meta binding when only ctrl is held", () => {
    const callback = vi.fn();
    renderHook(() =>
      useKey("k", callback, { isCtrlKey: true, isMetaKey: true })
    );

    dispatchKey({ ctrlKey: true, key: "k" });

    expect(callback).toHaveBeenCalledOnce();
  });

  it("fires a ctrl-or-meta binding when only meta is held", () => {
    const callback = vi.fn();
    renderHook(() =>
      useKey("k", callback, { isCtrlKey: true, isMetaKey: true })
    );

    dispatchKey({ key: "k", metaKey: true });

    expect(callback).toHaveBeenCalledOnce();
  });

  it("does not fire a plain binding when only meta is held", () => {
    const callback = vi.fn();
    renderHook(() => useKey("k", callback));

    dispatchKey({ key: "k", metaKey: true });

    expect(callback).not.toHaveBeenCalled();
  });

  it("does not fire a plain binding from a focused input", () => {
    const callback = vi.fn();
    const view = render(<input aria-label="Title" />);
    const input = view.getByRole("textbox");
    input.focus();
    renderHook(() => useKey(" ", callback));

    dispatchKeyOn(input, { key: " " });

    expect(callback).not.toHaveBeenCalled();
  });

  it.each([
    [
      "button",
      <button key="button" type="button">
        Action
      </button>,
    ],
    [
      "link",
      <a href="https://example.com" key="link">
        Example
      </a>,
    ],
    [
      "select",
      <select aria-label="Map" key="select">
        <option>One</option>
      </select>,
    ],
    [
      "menu",
      <div key="menu" role="menu">
        Menu
      </div>,
    ],
    [
      "menu item",
      <div key="menuitem" role="menuitem">
        Item
      </div>,
    ],
    [
      "radio menu item",
      <div aria-checked="false" key="menuitemradio" role="menuitemradio">
        Item
      </div>,
    ],
    [
      "switch",
      <div aria-checked="false" key="switch" role="switch">
        Sharing
      </div>,
    ],
    [
      "dialog",
      <div key="dialog" role="dialog">
        Editor
      </div>,
    ],
    [
      "Radix popper content",
      <div data-radix-popper-content-wrapper="" key="radix">
        Popover
      </div>,
    ],
  ])("leaves a modifier-free binding native on a %s", (_label, element) => {
    const callback = vi.fn();
    const view = render(element);
    const target = view.container.firstElementChild!;
    renderHook(() => useKey("Enter", callback));

    const event = dispatchKeyOn(target, { key: "Enter" });

    expect(callback).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("guards content nested inside an interactive ancestor", () => {
    const callback = vi.fn();
    const view = render(
      <button type="button">
        <span>Action label</span>
      </button>
    );
    const target = view.getByText("Action label");
    renderHook(() => useKey("Enter", callback));

    const event = dispatchKeyOn(target, { key: "Enter" });

    expect(callback).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("allows an opted-in Escape binding from an input inside a dialog", () => {
    const callback = vi.fn();
    const view = render(
      <div role="dialog">
        <input aria-label="Title" />
      </div>
    );
    const input = view.getByRole("textbox");
    renderHook(() => useKey("Escape", callback, { allowWhenTyping: true }));

    const event = dispatchKeyOn(input, { key: "Escape" });

    expect(callback).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("bails when an upstream listener already prevented the event", () => {
    const callback = vi.fn();
    renderHook(() => useKey("k", callback));
    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "k",
    });
    event.preventDefault();

    act(() => {
      window.dispatchEvent(event);
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("does not fire a plain binding when shift is held", () => {
    const callback = vi.fn();
    renderHook(() => useKey("k", callback));

    dispatchKey({ key: "k", shiftKey: true });

    expect(callback).not.toHaveBeenCalled();
  });

  it("fires a shift binding only when shift is held", () => {
    const callback = vi.fn();
    renderHook(() => useKey("k", callback, { isShiftKey: true }));

    dispatchKey({ key: "k" });
    dispatchKey({ key: "k", shiftKey: true });

    expect(callback).toHaveBeenCalledOnce();
  });

  it("fires an alt binding only when alt is held", () => {
    const callback = vi.fn();
    renderHook(() => useKey("k", callback, { isAltKey: true }));

    dispatchKey({ key: "k" });
    dispatchKey({ altKey: true, key: "k" });

    expect(callback).toHaveBeenCalledOnce();
  });

  it("prevents the default action and stops propagation", () => {
    const callback = vi.fn();
    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "k",
    });
    const preventDefault = vi.spyOn(event, "preventDefault");
    const stopPropagation = vi.spyOn(event, "stopPropagation");
    renderHook(() => useKey("k", callback));

    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("removes the keyboard listener after unmount", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useKey("k", callback));
    unmount();

    dispatchKey({ key: "k" });

    expect(callback).not.toHaveBeenCalled();
  });
});

/** Dispatches a cancelable keydown event through the hook's real window listener. */
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
