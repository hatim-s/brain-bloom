"use client";

import { useSignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  if (awaitingVerification) {
    return (
      <form
        className="flex flex-col min-w-[400px] max-w-[400px] mx-auto"
        onSubmit={handleVerification}
      >
        <h1 className="text-2xl font-semibold tracking-tight">
          Verify your email
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the code Clerk sent to your email address.
        </p>
        <div className="flex flex-col gap-2 [&>input]:mb-3 mt-8">
          <Label htmlFor="code">Verification code</Label>
          <Input
            autoComplete="one-time-code"
            id="code"
            inputMode="numeric"
            name="code"
            required
          />
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? "Verifying..." : "Verify email"}
          </Button>
          {errorMessage ? (
            <FormMessage message={{ error: errorMessage }} />
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col min-w-[400px] max-w-[400px] mx-auto"
      onSubmit={handleSignUp}
    >
      <h1 className="text-2xl font-semibold tracking-tight">Sign up</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          className="font-medium text-primary underline underline-offset-4"
          href="/sign-in"
        >
          Sign in
        </Link>
      </p>
      <div className="flex flex-col gap-2 [&>input]:mb-3 mt-8">
        <Label htmlFor="emailAddress">Email</Label>
        <Input
          autoComplete="email"
          id="emailAddress"
          name="emailAddress"
          placeholder="you@example.com"
          required
          type="email"
        />
        <Label htmlFor="password">Password</Label>
        <Input
          autoComplete="new-password"
          id="password"
          minLength={8}
          name="password"
          placeholder="Your password"
          required
          type="password"
        />
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing up..." : "Sign up"}
        </Button>
        {errorMessage ? (
          <FormMessage message={{ error: errorMessage }} />
        ) : null}
      </div>
    </form>
  );
}
