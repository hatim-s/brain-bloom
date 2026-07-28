import { useEffect } from "react";

type UseKeyOptions = {
  isMetaKey?: boolean;
  isCtrlKey?: boolean;
  isShiftKey?: boolean;
  isAltKey?: boolean;
  allowWhenTyping?: boolean;
};

/** Runs a keyboard callback when its key and requested modifiers match. */
export function useKey(
  key: KeyboardEvent["key"] | KeyboardEvent["code"],
  callback: () => void,
  opts?: UseKeyOptions
) {
  const {
    isMetaKey = false,
    isCtrlKey = false,
    isShiftKey = false,
    isAltKey = false,
    allowWhenTyping = false,
  } = opts ?? {};

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      const hasCtrlOrMetaBinding = isMetaKey || isCtrlKey;
      const ctrlOrMetaMatches = hasCtrlOrMetaBinding
        ? (isMetaKey && event.metaKey) || (isCtrlKey && event.ctrlKey)
        : !event.metaKey && !event.ctrlKey;

      if (
        (event.key === key || event.code === `Key${key.toUpperCase()}`) &&
        ctrlOrMetaMatches &&
        event.shiftKey === isShiftKey &&
        event.altKey === isAltKey &&
        (allowWhenTyping || hasCtrlOrMetaBinding || !isEditableTarget)
      ) {
        event.preventDefault();
        event.stopPropagation();

        callback();
      }
    };

    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [
    key,
    callback,
    isMetaKey,
    isCtrlKey,
    isShiftKey,
    isAltKey,
    allowWhenTyping,
  ]);
}
