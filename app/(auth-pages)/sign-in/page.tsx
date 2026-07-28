"use client";

import { useSignIn } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Provides the minimal password-based Clerk Core 3 sign-in flow. */
export default function Login() {
  const { signIn, fetchStatus } = useSignIn();
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isSubmitting = fetchStatus === "fetching";

  /** Creates and finalizes a Clerk password sign-in attempt. */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const identifier = formData.get("identifier")?.toString() ?? "";
    const password = formData.get("password")?.toString() ?? "";
    const { error } = await signIn.create({ identifier, password });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    if (signIn.status !== "complete") {
      setErrorMessage("Additional verification is required to sign in.");
      return;
    }

    const { error: finalizeError } = await signIn.finalize();
    if (finalizeError) {
      setErrorMessage(finalizeError.longMessage ?? finalizeError.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form
      className="flex flex-col min-w-[400px] max-w-[400px] mx-auto"
      onSubmit={handleSubmit}
    >
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          className="font-medium text-primary underline underline-offset-4"
          href="/sign-up"
        >
          Sign up
        </Link>
      </p>
      <div className="flex flex-col gap-2 [&>input]:mb-3 mt-8">
        <Label htmlFor="identifier">Email</Label>
        <Input
          autoComplete="email"
          id="identifier"
          name="identifier"
          placeholder="you@example.com"
          required
          type="email"
        />
        <Label htmlFor="password">Password</Label>
        <Input
          autoComplete="current-password"
          id="password"
          name="password"
          placeholder="Your password"
          required
          type="password"
        />
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
        {errorMessage ? (
          <FormMessage message={{ error: errorMessage }} />
        ) : null}
      </div>
    </form>
  );
}
