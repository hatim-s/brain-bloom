"use client";

import { useSignIn } from "@clerk/nextjs";
import type { SignInStatus } from "@clerk/nextjs/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildAuthPageUrl, sanitizeRedirectUrl } from "@/lib/auth-routing";

import { type AuthOAuthStrategy, OAuthButtons } from "../oauth-buttons";

type SignInMode = "password" | "reset";
type ResetStep = "email" | "code" | "password";

/**
 * Explains every incomplete Core 3 sign-in state without collapsing distinct
 * remediation paths into one generic error.
 */
function getIncompleteSignInMessage(status: SignInStatus): string {
  switch (status) {
    case "needs_identifier":
      return "Enter the email address for your account to continue.";
    case "needs_first_factor":
      return "A first-factor check is still required. Confirm your email and password, then try again.";
    case "needs_second_factor":
      return "This account has two-factor authentication enabled. Sprig cannot complete two-factor verification yet.";
    case "needs_client_trust":
      return "Additional verification is required to trust this device. Sprig cannot complete that check yet.";
    case "needs_protect_check":
      return "Additional verification is required by Clerk Protect. Sprig cannot complete that check yet.";
    case "needs_new_password":
      return "Set a new password to finish signing in.";
    case "complete":
      return "Sign-in is ready to finish.";
  }
}

/** Provides password sign-in and Clerk Core 3 email-code password recovery. */
function LoginForm() {
  const { signIn, fetchStatus } = useSignIn();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = sanitizeRedirectUrl(searchParams.get("redirect_url"));
  const signUpUrl = buildAuthPageUrl("/sign-up", redirectUrl);
  const signInCallbackUrl = buildAuthPageUrl("/sign-in", redirectUrl);
  const [mode, setMode] = useState<SignInMode>("password");
  const [resetStep, setResetStep] = useState<ResetStep>("email");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isSubmitting = fetchStatus === "fetching";

  /** Finalizes the completed attempt and restores the requested destination. */
  async function finalizeSignIn() {
    const { error } = await signIn.finalize();
    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    router.push(redirectUrl);
    router.refresh();
  }

  /** Creates and finalizes a Clerk password sign-in attempt. */
  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const identifier = formData.get("identifier")?.toString() ?? "";
    const password = formData.get("password")?.toString() ?? "";
    const { error } = await signIn.create({ identifier, password });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    if (signIn.status === "needs_new_password") {
      setMode("reset");
      setResetStep("password");
      return;
    }

    if (signIn.status !== "complete") {
      setErrorMessage(getIncompleteSignInMessage(signIn.status));
      return;
    }

    await finalizeSignIn();
  }

  /** Starts a fresh reset attempt and sends a code to the account email. */
  async function handleResetEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);

    const { error: resetError } = await signIn.reset();
    if (resetError) {
      setErrorMessage(resetError.longMessage ?? resetError.message);
      return;
    }

    const formData = new FormData(event.currentTarget);
    const identifier = formData.get("identifier")?.toString() ?? "";
    const { error: createError } = await signIn.create({ identifier });
    if (createError) {
      setErrorMessage(createError.longMessage ?? createError.message);
      return;
    }

    const { error: codeError } = await signIn.resetPasswordEmailCode.sendCode();
    if (codeError) {
      setErrorMessage(codeError.longMessage ?? codeError.message);
      return;
    }

    setResetStep("code");
  }

  /** Verifies the one-time reset code and unlocks the new-password step. */
  async function handleResetCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const code = formData.get("code")?.toString() ?? "";
    const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code });
    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    if (signIn.status !== "needs_new_password") {
      setErrorMessage(getIncompleteSignInMessage(signIn.status));
      return;
    }

    setResetStep("password");
  }

  /** Submits the replacement password, finalizes, and enters the application. */
  async function handleNewPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const password = formData.get("password")?.toString() ?? "";
    const { error } = await signIn.resetPasswordEmailCode.submitPassword({
      password,
    });
    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    if (signIn.status !== "complete") {
      setErrorMessage(getIncompleteSignInMessage(signIn.status));
      return;
    }

    await finalizeSignIn();
  }

  /** Clears the recovery attempt and restores the normal password form. */
  async function handleBackToPassword() {
    setErrorMessage(null);
    await signIn.reset();
    setResetStep("email");
    setMode("password");
  }

  /**
   * Hands sign-in off to a social provider while preserving the deep link.
   *
   * `sso()` navigates away on success, so the only path back into this
   * component is the error one.
   */
  async function handleOAuth(strategy: AuthOAuthStrategy) {
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);

    const { error } = await signIn.sso({
      redirectCallbackUrl: signInCallbackUrl,
      redirectUrl,
      strategy,
    });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
    }
  }

  if (mode === "reset") {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Password recovery
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {resetStep === "email"
              ? "Reset your password"
              : resetStep === "code"
                ? "Check your email"
                : "Choose a new password"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {resetStep === "email"
              ? "Enter your account email and we will send a verification code."
              : resetStep === "code"
                ? "Enter the one-time code sent to your account email."
                : "Your identity is verified. Set the password you will use next time."}
          </p>
        </div>

        {resetStep === "email" ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={handleResetEmailSubmit}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="reset-identifier">Email</Label>
              <Input
                autoComplete="email"
                id="reset-identifier"
                name="identifier"
                placeholder="you@example.com"
                required
                type="email"
              />
            </div>
            {errorMessage ? (
              <div role="alert">
                <FormMessage message={{ error: errorMessage }} />
              </div>
            ) : null}
            <Button className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Sending code..." : "Send reset code"}
            </Button>
          </form>
        ) : null}

        {resetStep === "code" ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={handleResetCodeSubmit}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="reset-code">Verification code</Label>
              <Input
                autoComplete="one-time-code"
                className="font-mono tracking-[0.35em]"
                id="reset-code"
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
            <Button className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Verifying..." : "Verify code"}
            </Button>
          </form>
        ) : null}

        {resetStep === "password" ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={handleNewPasswordSubmit}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                aria-describedby="new-password-hint"
                autoComplete="new-password"
                id="new-password"
                minLength={8}
                name="password"
                placeholder="Your new password"
                required
                type="password"
              />
              <p
                className="text-xs text-muted-foreground"
                id="new-password-hint"
              >
                At least 8 characters.
              </p>
            </div>
            {errorMessage ? (
              <div role="alert">
                <FormMessage message={{ error: errorMessage }} />
              </div>
            ) : null}
            <Button className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Saving password..." : "Save new password"}
            </Button>
          </form>
        ) : null}

        <button
          className="self-start text-sm font-medium text-primary underline underline-offset-4 transition-colors duration-200 ease-organic hover:text-primary/80 motion-reduce:transition-none"
          disabled={isSubmitting}
          onClick={handleBackToPassword}
          type="button"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Sign in
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            className="font-medium text-primary underline underline-offset-4 transition-colors duration-200 ease-organic hover:text-primary/80 motion-reduce:transition-none"
            href={signUpUrl}
          >
            Sign up
          </Link>
        </p>
      </div>

      <OAuthButtons disabled={isSubmitting} onSelect={handleOAuth} />

      <form className="flex flex-col gap-5" onSubmit={handlePasswordSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="identifier">Email</Label>
          <Input
            autoComplete="email"
            id="identifier"
            name="identifier"
            placeholder="you@example.com"
            required
            type="email"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="password">Password</Label>
            <button
              className="text-xs font-medium text-muted-foreground underline underline-offset-4 transition-colors duration-200 ease-organic hover:text-foreground motion-reduce:transition-none"
              disabled={isSubmitting}
              onClick={() => {
                setErrorMessage(null);
                setMode("reset");
              }}
              type="button"
            >
              Forgot password?
            </button>
          </div>
          <Input
            autoComplete="current-password"
            id="password"
            name="password"
            placeholder="Your password"
            required
            type="password"
          />
        </div>
        {errorMessage ? (
          <div role="alert">
            <FormMessage message={{ error: errorMessage }} />
          </div>
        ) : null}
        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

/**
 * Page shell: useSearchParams() forces a CSR bailout, so the form must sit
 * under a Suspense boundary for the static prerender pass to succeed.
 */
function Login() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

export { Login as default };
