import { useEffect } from "react";

type UseKeyOptions = {
  enabled?: boolean;
  isMetaKey?: boolean;
  isCtrlKey?: boolean;
  isShiftKey?: boolean;
  isAltKey?: boolean;
  allowWhenTyping?: boolean;
};

const INTERACTIVE_TARGET_SELECTOR = [
  "button",
  "a",
  "select",
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="switch"]',
  '[role="dialog"]',
  "[data-radix-popper-content-wrapper]",
].join(",");

/** Runs a keyboard callback when its key and requested modifiers match. */
export function useKey(
  key: KeyboardEvent["key"] | KeyboardEvent["code"],
  callback: () => void,
  opts?: UseKeyOptions
) {
  const {
    enabled = true,
    isMetaKey = false,
    isCtrlKey = false,
    isShiftKey = false,
    isAltKey = false,
    allowWhenTyping = false,
  } = opts ?? {};

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      const isInteractiveTarget =
        target instanceof Element &&
        target.closest(INTERACTIVE_TARGET_SELECTOR) !== null;
      const hasCtrlOrMetaBinding = isMetaKey || isCtrlKey;
      const isModifierFreeBinding =
        !isMetaKey && !isCtrlKey && !isShiftKey && !isAltKey;
      const ctrlOrMetaMatches = hasCtrlOrMetaBinding
        ? (isMetaKey && event.metaKey) || (isCtrlKey && event.ctrlKey)
        : !event.metaKey && !event.ctrlKey;

      if (event.key !== key && event.code !== `Key${key.toUpperCase()}`) {
        return;
      }

      if (
        !ctrlOrMetaMatches ||
        event.shiftKey !== isShiftKey ||
        event.altKey !== isAltKey
      ) {
        return;
      }

      if (!allowWhenTyping && !hasCtrlOrMetaBinding && isEditableTarget) {
        return;
      }

      // Escape bindings deliberately opt into typing contexts so editors can
      // close from inputs, including inputs nested inside dialogs.
      if (!allowWhenTyping && isModifierFreeBinding && isInteractiveTarget) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      callback();
    };

    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [
    key,
    callback,
    enabled,
    isMetaKey,
    isCtrlKey,
    isShiftKey,
    isAltKey,
    allowWhenTyping,
  ]);
}
