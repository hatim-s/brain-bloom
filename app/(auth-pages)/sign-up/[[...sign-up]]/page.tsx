import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

/** Renders Clerk sign-up behind the dynamic boundary required by Next.js. */
export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <div className="flex min-h-screen items-center justify-center">
        <SignUp />
      </div>
    </Suspense>
  );
}
