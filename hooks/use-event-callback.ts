import {
  DependencyList,
  EffectCallback,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

function useIsomorphicLayoutEffect(
  effect: EffectCallback,
  deps: DependencyList
) {
  const effectFn = typeof window === "undefined" ? useLayoutEffect : useEffect;
  effectFn(effect, deps);
}

export function useEventCallback<F extends (...args: unknown[]) => unknown>(
  fn: F
) {
  const ref = useRef<F>((() => {
    throw new Error("Cannot call an event handler while rendering.");
  }) as unknown as F);

  useIsomorphicLayoutEffect(() => {
    ref.current = fn;
  }, [fn]);

  return useCallback((...args: Parameters<F>) => ref.current(...args), []);
}
