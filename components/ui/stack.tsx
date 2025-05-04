// source: https://github.com/hatim-s/finflow/blob/main/components/ui/stack.tsx

import { cva } from "class-variance-authority";
import { ComponentProps, forwardRef } from "react";

export type StackProps = ComponentProps<"div"> & {
  direction?: "row" | "column";
};

const stackVariants = cva("flex", {
  variants: {
    direction: {
      row: "flex-row",
      column: "flex-col",
    },
  },
});

export const Stack = forwardRef<HTMLDivElement, StackProps>(
  function Stack(props, ref) {
    const { direction, className, children, ...rest } = props;
    return (
      <div
        {...rest}
        className={stackVariants({ direction, className })}
        ref={ref}
      >
        {children}
      </div>
    );
  },
);
