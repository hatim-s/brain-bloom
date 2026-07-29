import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

/** Renders Clerk sign-in behind the dynamic boundary required by Next.js. */
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <div className="flex min-h-screen items-center justify-center">
        <SignIn />
      </div>
    </Suspense>
  );
}
