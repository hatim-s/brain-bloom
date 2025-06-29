// source: https://github.com/hatim-s/finflow/blob/main/components/ui/typography.tsx

import { ComponentPropsWithRef, forwardRef, PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

const TypographyH1 = forwardRef<
  HTMLHeadingElement,
  PropsWithChildren<Omit<TypographyProps, "variant">>
>(function TypographyH1({ children, className }, ref) {
  return (
    <h1
      ref={ref}
      className={cn(
        "scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl",
        className
      )}
    >
      {children}
    </h1>
  );
});

const TypographyH2 = forwardRef<
  HTMLHeadingElement,
  PropsWithChildren<Omit<TypographyProps, "variant">>
>(function TypographyH2({ children, className }, ref) {
  return (
    <h2
      ref={ref}
      className={cn(
        "scroll-m-20 text-3xl font-extrabold tracking-tight first:mt-0",
        className
      )}
    >
      {children}
    </h2>
  );
});

const TypographyH3 = forwardRef<
  HTMLHeadingElement,
  PropsWithChildren<Omit<TypographyProps, "variant">>
>(function TypographyH3({ children, className }, ref) {
  return (
    <h3
      ref={ref}
      className={cn(
        "scroll-m-20 text-xl font-semibold tracking-tight",
        className
      )}
    >
      {children}
    </h3>
  );
});

const TypographyH4 = forwardRef<
  HTMLHeadingElement,
  PropsWithChildren<Omit<TypographyProps, "variant">>
>(function TypographyH4({ children, className }, ref) {
  return (
    <h4
      ref={ref}
      className={cn(
        "scroll-m-20 text-xl font-semibold tracking-tight",
        className
      )}
    >
      {children}
    </h4>
  );
});

const TypographyP = forwardRef<
  HTMLParagraphElement,
  PropsWithChildren<Omit<TypographyProps, "variant">>
>(function TypographyP({ children, className }, ref) {
  return (
    <p ref={ref} className={cn(className)}>
      {children}
    </p>
  );
});

const TypographyVariantsMap = {
  h1: TypographyH1,
  h2: TypographyH2,
  h3: TypographyH3,
  h4: TypographyH4,
  p: TypographyP,
};

export type TypographyProps = ComponentPropsWithRef<
  "h1" | "h2" | "h3" | "h4" | "p"
> & {
  variant: "h1" | "h2" | "h3" | "h4" | "p";
};

export const Typography = forwardRef<
  HTMLParagraphElement | HTMLHeadingElement,
  PropsWithChildren<TypographyProps>
>(function TypographyComponent({ variant, children, ...props }, ref) {
  const Component = TypographyVariantsMap[variant];

  return (
    <Component ref={ref} {...props}>
      {children}
    </Component>
  );
});
