"use client";

import { type ComponentProps } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

type SubmitButtonProps = ComponentProps<typeof Button> & {
  pendingText?: string;
};

/**
 * Submit control for a server-action form.
 *
 * While the action is in flight the label is swapped rather than the button
 * being replaced by a spinner, so the control keeps its width and the layout
 * stays still. It is marked `aria-disabled` instead of `disabled` so the
 * button keeps focus through the submission.
 */
function SubmitButton({
  children,
  pendingText = "Submitting…",
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button aria-disabled={pending} type="submit" {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}

export { SubmitButton };
