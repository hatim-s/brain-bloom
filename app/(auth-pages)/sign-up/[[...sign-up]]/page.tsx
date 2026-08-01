import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

/**
 * Renders Clerk sign-up behind the dynamic boundary required by Next.js.
 *
 * The grove ground — moss canopy field, canvas dot grid, centred column — comes
 * from the (auth-pages) layout; the widget supplies its own raised sheet, themed
 * globally through ClerkProvider's appearance, so nothing is added around it
 * here that would read as a second card.
 */
function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUp />
    </Suspense>
  );
}

export { SignUpPage as default };
