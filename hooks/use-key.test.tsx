// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useKey } from "./use-key";

afterEach(cleanup);

/** Characterization — pins keyboard matching quirks before the P3 canvas changes. */
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

  it("fires a plain binding when only meta is held", () => {
    const callback = vi.fn();
    renderHook(() => useKey("k", callback));

    // Characterized quirk: the default ctrl=false half satisfies the modifier OR.
    dispatchKey({ key: "k", metaKey: true });

    expect(callback).toHaveBeenCalledOnce();
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
