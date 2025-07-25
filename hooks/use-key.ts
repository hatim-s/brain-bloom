import { useEffect } from "react";

export function useKey(
  key: KeyboardEvent["key"] | KeyboardEvent["code"],
  callback: () => void,
  opts?: {
    isMetaKey?: boolean;
    isCtrlKey?: boolean;
    isShiftKey?: boolean;
    isAltKey?: boolean;
  }
) {
  const {
    isMetaKey = false,
    isCtrlKey = false,
    isShiftKey = false,
    isAltKey = false,
  } = opts ?? {};

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        (event.key === key || event.code === `Key${key.toUpperCase()}`) &&
        (event.metaKey === isMetaKey || event.ctrlKey === isCtrlKey) &&
        event.shiftKey === isShiftKey &&
        event.altKey === isAltKey
      ) {
        // we do not want to trigger the default behavior of any key
        event.preventDefault();
        event.stopPropagation();

        callback();
      }
    };

    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [key, callback, isMetaKey, isCtrlKey, isShiftKey, isAltKey]);
}
