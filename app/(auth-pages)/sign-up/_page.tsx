"use client";

import { useSignUp } from "@clerk/nextjs";
import type { SignUpField } from "@clerk/nextjs/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, ReactNode, Suspense, useState } from "react";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildAuthPageUrl, sanitizeRedirectUrl } from "@/lib/auth-routing";

import { type AuthOAuthStrategy, OAuthButtons } from "../oauth-buttons";

type SignUpStep = "form" | "verification" | "finalize";

/**
 * The auth sheet: one raised card lifted off the grove ground, 16px rounding, a
 * decorative hairline edge and the Rest shadow. All three sign-up steps render
 * into the same sheet so the surface under the user never changes shape as the
 * flow advances.
 */
const AUTH_SHEET_CLASS =
  "flex w-full flex-col gap-6 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-rest sm:p-8";

/**
 * Accent link finish: moss text over a faint underline that firms up on hover,
 * so the link is legible at rest without drawing a hard rule through the copy.
 */
const ACCENT_LINK_CLASS =
  "rounded-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors duration-200 ease-settle hover:decoration-primary motion-reduce:transition-none";

/** Tertiary action finish: quiet until pointed at, never competing with moss. */
const QUIET_ACTION_CLASS =
  "rounded-sm text-[0.8125rem] font-medium text-muted-foreground underline-offset-4 transition-colors duration-200 ease-settle hover:text-foreground hover:underline disabled:opacity-50 motion-reduce:transition-none";

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

/**
 * Masthead of the auth card: an optional quiet step marker, the headline, and
 * one warm line of invitation. Sentence case throughout — the system has no
 * uppercase-tracked labels.
 */
function CardHeading({
  children,
  step,
  title,
}: {
  children: ReactNode;
  step?: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {step ? (
        <p className="text-[0.8125rem] font-medium text-muted-foreground">
          {step}
        </p>
      ) : null}
      <h1 className="text-[1.75rem] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground">
        {title}
      </h1>
      <p className="text-[0.9375rem] leading-[1.55] text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

/** Inline submission result, rendered at the same finish in every flow state. */
function FormAlert({ message }: { message: string }) {
  return (
    <div role="alert">
      <FormMessage message={{ error: message }} />
    </div>
  );
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
      <div className={AUTH_SHEET_CLASS}>
        <CardHeading step="Email verified" title="One last step">
          Your email is confirmed. Finish setting up your account and your first
          map is one prompt away.
        </CardHeading>

        {errorMessage ? <FormAlert message={errorMessage} /> : null}

        <Button
          className="w-full"
          disabled={isSubmitting}
          onClick={finalizeSignUp}
          size="lg"
          type="button"
        >
          {isSubmitting ? "Finishing…" : "Finish setting up"}
        </Button>

        <p className="border-t border-border pt-5 text-center text-[0.8125rem] text-muted-foreground">
          Already have an account?{" "}
          <Link className={ACCENT_LINK_CLASS} href={signInUrl}>
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  if (step === "verification") {
    return (
      <div className={AUTH_SHEET_CLASS}>
        <CardHeading step="Step 2 of 2" title="Check your inbox">
          We sent a code to your email address. Enter it below and your account
          is ready.
        </CardHeading>

        <form
          aria-busy={isSubmitting}
          className="flex flex-col gap-4"
          onSubmit={handleVerification}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Verification code</Label>
            <Input
              autoComplete="one-time-code"
              className="text-center font-mono text-base tracking-[0.35em]"
              id="code"
              inputMode="numeric"
              name="code"
              required
            />
          </div>
          {errorMessage ? <FormAlert message={errorMessage} /> : null}
          {resendMessage ? (
            <div role="status">
              <FormMessage message={{ success: resendMessage }} />
            </div>
          ) : null}
          <Button
            className="w-full"
            disabled={isSubmitting}
            size="lg"
            type="submit"
          >
            {isSubmitting ? "Verifying…" : "Verify email"}
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <button
            className={QUIET_ACTION_CLASS}
            disabled={isSubmitting}
            onClick={handleResendCode}
            type="button"
          >
            Send a new code
          </button>
          <button
            className={QUIET_ACTION_CLASS}
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
    <div className={AUTH_SHEET_CLASS}>
      <CardHeading title="Start your first map">
        Give Sprig a topic you are studying and watch it branch into something
        you can explore.
      </CardHeading>

      <OAuthButtons disabled={isSubmitting} onSelect={handleOAuth} />

      <form
        aria-busy={isSubmitting}
        className="flex flex-col gap-4"
        onSubmit={handleSignUp}
      >
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
            placeholder="Create a password"
            required
            type="password"
          />
          <p
            className="text-[0.8125rem] text-muted-foreground"
            id="password-hint"
          >
            At least 8 characters.
          </p>
        </div>
        {errorMessage ? <FormAlert message={errorMessage} /> : null}
        <Button
          className="w-full"
          disabled={isSubmitting}
          size="lg"
          type="submit"
        >
          {isSubmitting ? "Creating your account…" : "Create account"}
        </Button>
      </form>

      <p className="border-t border-border pt-5 text-center text-[0.8125rem] text-muted-foreground">
        Already have an account?{" "}
        <Link className={ACCENT_LINK_CLASS} href={signInUrl}>
          Sign in
        </Link>
      </p>
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
