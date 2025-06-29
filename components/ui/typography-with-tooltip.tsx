import { TooltipPortal } from "@radix-ui/react-tooltip";
import clsx from "clsx";
import {
  forwardRef,
  PropsWithChildren,
  useEffect,
  useRef,
  useState,
} from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { Typography, TypographyProps } from "./typography";

// Typography component with tooltip on overflow
export const TypographyWithTooltip = forwardRef<
  HTMLParagraphElement | HTMLHeadingElement,
  PropsWithChildren<TypographyProps> & {
    tooltipClassName?: string;
    maxLines?: number;
  }
>(function TypographyWithTooltipComponent(
  {
    children,
    variant = "p",
    className = "",
    tooltipClassName = "",
    maxLines = 1,
    ...props
  },
  ref
) {
  const textRef = useRef<HTMLParagraphElement | HTMLHeadingElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [shouldShowTooltip, setShouldShowTooltip] = useState(false);

  useEffect(() => {
    const checkOverflow = () => {
      if (textRef.current) {
        const element = textRef.current;

        // For single line truncation
        if (maxLines === 1) {
          const isOverflowing = element.scrollWidth > element.clientWidth;
          setIsOverflowing(isOverflowing);
          setShouldShowTooltip(isOverflowing);
        } else {
          // For multi-line truncation
          const isOverflowing = element.scrollHeight > element.clientHeight;
          setIsOverflowing(isOverflowing);
          setShouldShowTooltip(isOverflowing);
        }
      }
    };

    checkOverflow();

    // Check on window resize
    window.addEventListener("resize", checkOverflow);
    return () => window.removeEventListener("resize", checkOverflow);
  }, [children, maxLines]);

  const truncateClasses =
    maxLines === 1 ? "truncate" : `line-clamp-${maxLines}`;

  const content = (
    <Typography
      ref={textRef}
      variant={variant}
      className={`${truncateClasses} ${className}`}
      {...props}
    >
      {children}
    </Typography>
  );

  if (!shouldShowTooltip) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger>{content}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent className={tooltipClassName}>
          <Typography
            {...props}
            variant={variant}
            className={clsx(
              "max-w-xs whitespace-normal break-words",
              className
            )}
          >
            {children}
          </Typography>
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
});
