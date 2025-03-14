// source: https://github.com/hatim-s/finflow/blob/main/components/ui/box.tsx

import { ComponentProps, forwardRef } from "react";

export type BoxProps = ComponentProps<"div">;

export const Box = forwardRef<HTMLDivElement, BoxProps>(
  function Box(props, ref) {
    const { children, ...rest } = props;
    return (
      <div ref={ref} {...rest}>
        {children}
      </div>
    );
  },
);
