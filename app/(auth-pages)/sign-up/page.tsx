"use client";

import { useSignUp } from "@clerk/nextjs";
import type { SignUpField } from "@clerk/nextjs/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildAuthPageUrl, sanitizeRedirectUrl } from "@/lib/auth-routing";

import { type AuthOAuthStrategy, OAuthButtons } from "../oauth-buttons";

type SignUpStep = "form" | "verification" | "finalize";

const SIGN_UP_FIELD_LABELS: Partial<Record<SignUpField, string>> = {
  email_address: "email address",
  email_address_or_phone_number: "email address or phone number",
  first_name: "first name",
  last_name: "last name",
  legal_accepted: "legal acceptance",
  password: "password",
  phone_number: "phone number",
  protect_check: "additional verification",
  username: "username",
  web3_wallet: "Web3 wallet",
};

/** Turns Clerk's field identifiers into an explicit, readable requirement list. */
function formatRequirements(fields: SignUpField[]): string {
  return fields
    .map(
      (field) =>
        SIGN_UP_FIELD_LABELS[field] ?? field.replaceAll("_", " ").trim()
    )
    .join(", ");
}

/** Provides the password and email-code Clerk Core 3 sign-up flow. */
function SignupForm() {
  const { signUp, fetchStatus } = useSignUp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = sanitizeRedirectUrl(searchParams.get("redirect_url"));
  const signInUrl = buildAuthPageUrl("/sign-in", redirectUrl);
  const signUpCallbackUrl = buildAuthPageUrl("/sign-up", redirectUrl);
  const [step, setStep] = useState<SignUpStep>("form");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const isSubmitting = fetchStatus === "fetching";

  /** Names everything Clerk still requires before this sign-up can complete. */
  function getMissingRequirementsMessage(): string {
    const requirements = [...signUp.missingFields, ...signUp.unverifiedFields];

    if (requirements.length > 0) {
      return `Clerk still requires: ${formatRequirements(requirements)}.`;
    }

    if (signUp.status === "abandoned") {
      return "Clerk marked this sign-up attempt as abandoned. Use a different email to start again.";
    }

    return `Clerk cannot finish this sign-up while its status is "${signUp.status}".`;
  }

  /** Activates a completed Clerk sign-up and enters the requested destination. */
  async function finalizeSignUp() {
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);

    const { error } = await signUp.finalize();
    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    router.push(redirectUrl);
    router.refresh();
  }

  /** Creates a fresh Clerk sign-up and sends its email verification code. */
  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);
    setResendMessage(null);

    const formData = new FormData(event.currentTarget);
    const emailAddress = formData.get("emailAddress")?.toString() ?? "";
    const password = formData.get("password")?.toString() ?? "";
    const { error } = await signUp.create({ emailAddress, password });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    if (signUp.status === "complete") {
      setStep("finalize");
      await finalizeSignUp();
      return;
    }

    if (!signUp.unverifiedFields.includes("email_address")) {
      setErrorMessage(getMissingRequirementsMessage());
      return;
    }

    const { error: verificationError } =
      await signUp.verifications.sendEmailCode();
    if (verificationError) {
      setErrorMessage(
        verificationError.longMessage ?? verificationError.message
      );
      return;
    }

    setStep("verification");
  }

  /** Verifies the emailed code, then finalizes only a complete sign-up. */
  async function handleVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);
    setResendMessage(null);

    const formData = new FormData(event.currentTarget);
    const code = formData.get("code")?.toString() ?? "";
    const { error } = await signUp.verifications.verifyEmailCode({ code });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    if (signUp.status !== "complete") {
      setErrorMessage(getMissingRequirementsMessage());
      return;
    }

    // The email code is consumed now. A finalize failure moves to a dedicated
    // retry step so the code is never submitted a second time.
    setStep("finalize");
    await finalizeSignUp();
  }

  /** Sends a fresh code for the active sign-up attempt. */
  async function handleResendCode() {
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);
    setResendMessage(null);

    const { error } = await signUp.verifications.sendEmailCode();
    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    setResendMessage("A new verification code was sent.");
  }

  /** Clears the active attempt so the next submit runs a fresh create call. */
  async function handleDifferentEmail() {
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);
    setResendMessage(null);

    const { error } = await signUp.reset();
    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    setStep("form");
  }

  /** Hands sign-up off to a social provider while preserving the deep link. */
  async function handleOAuth(strategy: AuthOAuthStrategy) {
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);

    const { error } = await signUp.sso({
      redirectCallbackUrl: signUpCallbackUrl,
      redirectUrl,
      strategy,
    });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
    }
  }

  if (step === "finalize") {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Account verified
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Finish creating your account
          </h1>
          <p className="text-sm text-muted-foreground">
            Your email is verified. Retry finishing the account without reusing
            the verification code.
          </p>
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              className="font-medium text-primary underline underline-offset-4 transition-colors duration-200 ease-organic hover:text-primary/80 motion-reduce:transition-none"
              href={signInUrl}
            >
              Sign in
            </Link>
          </p>
        </div>
        {errorMessage ? (
          <div role="alert">
            <FormMessage message={{ error: errorMessage }} />
          </div>
        ) : null}
        <Button
          className="w-full"
          disabled={isSubmitting}
          onClick={finalizeSignUp}
          type="button"
        >
          {isSubmitting ? "Finishing…" : "Retry finishing sign up"}
        </Button>
      </div>
    );
  }

  if (step === "verification") {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Step 2 of 2
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Verify your email
          </h1>
          <p className="text-sm text-muted-foreground">
            We sent a code to your email address. Enter it below to finish
            setting up your account.
          </p>
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              className="font-medium text-primary underline underline-offset-4 transition-colors duration-200 ease-organic hover:text-primary/80 motion-reduce:transition-none"
              href={signInUrl}
            >
              Sign in
            </Link>
          </p>
        </div>

        <form className="flex flex-col gap-5" onSubmit={handleVerification}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Verification code</Label>
            <Input
              autoComplete="one-time-code"
              className="font-mono tracking-[0.35em]"
              id="code"
              inputMode="numeric"
              name="code"
              required
            />
          </div>
          {errorMessage ? (
            <div role="alert">
              <FormMessage message={{ error: errorMessage }} />
            </div>
          ) : null}
          {resendMessage ? (
            <div role="status">
              <FormMessage message={{ success: resendMessage }} />
            </div>
          ) : null}
          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Verifying…" : "Verify email"}
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            className="text-sm font-medium text-primary underline underline-offset-4 transition-colors duration-200 ease-organic hover:text-primary/80 motion-reduce:transition-none"
            disabled={isSubmitting}
            onClick={handleResendCode}
            type="button"
          >
            Resend code
          </button>
          <button
            className="text-sm font-medium text-muted-foreground underline underline-offset-4 transition-colors duration-200 ease-organic hover:text-foreground motion-reduce:transition-none"
            disabled={isSubmitting}
            onClick={handleDifferentEmail}
            type="button"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Sign up
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            className="font-medium text-primary underline underline-offset-4 transition-colors duration-200 ease-organic hover:text-primary/80 motion-reduce:transition-none"
            href={signInUrl}
          >
            Sign in
          </Link>
        </p>
      </div>

      <OAuthButtons disabled={isSubmitting} onSelect={handleOAuth} />

      <form className="flex flex-col gap-5" onSubmit={handleSignUp}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="emailAddress">Email</Label>
          <Input
            autoComplete="email"
            id="emailAddress"
            name="emailAddress"
            placeholder="you@example.com"
            required
            type="email"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            aria-describedby="password-hint"
            autoComplete="new-password"
            id="password"
            minLength={8}
            name="password"
            placeholder="Your password"
            required
            type="password"
          />
          <p className="text-xs text-muted-foreground" id="password-hint">
            At least 8 characters.
          </p>
        </div>
        {errorMessage ? (
          <div role="alert">
            <FormMessage message={{ error: errorMessage }} />
          </div>
        ) : null}
        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing up…" : "Sign up"}
        </Button>
      </form>
    </div>
  );
}

/**
 * Page shell: useSearchParams() forces a CSR bailout, so the form must sit
 * under a Suspense boundary for the static prerender pass to succeed.
 */
function Signup() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}

export { Signup as default };
