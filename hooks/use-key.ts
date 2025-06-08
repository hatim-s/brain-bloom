import { useEffect } from "react";

export function useKey(
  key: string,
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
        event.key === key &&
        event.metaKey === isMetaKey &&
        event.ctrlKey === isCtrlKey &&
        event.shiftKey === isShiftKey &&
        event.altKey === isAltKey
      ) {
        callback();
      }
    };

    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [key, callback, isMetaKey, isCtrlKey, isShiftKey, isAltKey]);
}
