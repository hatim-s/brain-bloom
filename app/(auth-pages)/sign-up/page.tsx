"use client";

import { useSignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { type AuthOAuthStrategy, OAuthButtons } from "../oauth-buttons";

/** Provides the minimal password and email-code Clerk Core 3 sign-up flow. */
export default function Signup() {
  const { signUp, fetchStatus } = useSignUp();
  const router = useRouter();
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isSubmitting = fetchStatus === "fetching";

  /** Activates a completed Clerk sign-up and enters the application. */
  async function finalizeSignUp() {
    const { error } = await signUp.finalize();
    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  /** Creates a Clerk sign-up and sends its email verification code. */
  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const emailAddress = formData.get("emailAddress")?.toString() ?? "";
    const password = formData.get("password")?.toString() ?? "";
    const { error } = await signUp.create({ emailAddress, password });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    if (signUp.status === "complete") {
      await finalizeSignUp();
      return;
    }

    if (!signUp.unverifiedFields.includes("email_address")) {
      setErrorMessage("Additional account details are required to sign up.");
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

    setAwaitingVerification(true);
  }

  /** Verifies the emailed code and finalizes the resulting session. */
  async function handleVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const code = formData.get("code")?.toString() ?? "";
    const { error } = await signUp.verifications.verifyEmailCode({ code });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    if (signUp.status !== "complete") {
      setErrorMessage("Email verification is not complete yet.");
      return;
    }

    await finalizeSignUp();
  }

  /**
   * Hands the sign-up off to a social provider.
   *
   * `sso()` navigates away on success, so the only path back into this
   * component is the error one. `redirectCallbackUrl` returns the user here
   * when the provider could not produce a session on its own.
   */
  async function handleOAuth(strategy: AuthOAuthStrategy) {
    setErrorMessage(null);

    const { error } = await signUp.sso({
      redirectCallbackUrl: "/sign-up",
      redirectUrl: "/",
      strategy,
    });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
    }
  }

  if (awaitingVerification) {
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
          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Verifying..." : "Verify email"}
          </Button>
        </form>
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
            href="/sign-in"
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
          {isSubmitting ? "Signing up..." : "Sign up"}
        </Button>
      </form>
    </div>
  );
}
