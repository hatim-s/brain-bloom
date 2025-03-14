// source: https://github.com/hatim-s/finflow/blob/main/components/ui/typography.tsx

import { PropsWithChildren } from "react";
import clsx from "clsx";

function TypographyH1({
  children,
  className,
}: PropsWithChildren<Omit<TypographyProps, "variant">>) {
  return (
    <h1
      className={clsx(
        "scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl",
        className,
      )}
    >
      {children}
    </h1>
  );
}

function TypographyH2({
  children,
  className,
}: PropsWithChildren<Omit<TypographyProps, "variant">>) {
  return (
    <h2
      className={clsx(
        "scroll-m-20 text-3xl font-semibold tracking-tight first:mt-0",
        className,
      )}
    >
      {children}
    </h2>
  );
}

function TypographyH3({
  children,
  className,
}: PropsWithChildren<Omit<TypographyProps, "variant">>) {
  return (
    <h3
      className={clsx(
        "scroll-m-20 text-2xl font-semibold tracking-tight",
        className,
      )}
    >
      {children}
    </h3>
  );
}

function TypographyH4({
  children,
  className,
}: PropsWithChildren<Omit<TypographyProps, "variant">>) {
  return (
    <h4
      className={clsx(
        "scroll-m-20 text-xl font-semibold tracking-tight",
        className,
      )}
    >
      {children}
    </h4>
  );
}

function TypographyP({
  children,
  className,
}: PropsWithChildren<Omit<TypographyProps, "variant">>) {
  return <p className={clsx(className)}>{children}</p>;
}

const TypographyVariantsMap = {
  h1: TypographyH1,
  h2: TypographyH2,
  h3: TypographyH3,
  h4: TypographyH4,
  p: TypographyP,
};

export type TypographyProps = {
  variant: "h1" | "h2" | "h3" | "h4" | "p";
  className?: string;
};

export function Typography({
  variant,
  children,
  ...props
}: PropsWithChildren<TypographyProps>) {
  const Component = TypographyVariantsMap[variant];

  return <Component {...props}>{children}</Component>;
}
