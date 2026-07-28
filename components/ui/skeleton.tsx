import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-sm bg-muted motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
