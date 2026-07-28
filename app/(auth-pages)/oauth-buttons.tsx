"use client";

import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";

/**
 * The social strategies Sprig offers. Both are members of Clerk's
 * `OAuthStrategy` template type (`oauth_${OAuthProvider}`), so they pass
 * straight into `signIn.sso()` / `signUp.sso()` without a cast.
 */
type AuthOAuthStrategy = "oauth_google" | "oauth_github";

/**
 * Social sign-in is off until P9 claims the Clerk instance: a keyless instance
 * has no OAuth credentials, so the buttons would only ever fail. Read at module
 * scope because Next inlines `NEXT_PUBLIC_*` by textual substitution.
 */
const IS_OAUTH_ENABLED = process.env.NEXT_PUBLIC_ENABLE_OAUTH === "true";

/**
 * Google's mark, flattened to a single path so it inherits `currentColor`
 * instead of dropping four brand colours into a two-hue palette.
 */
function GoogleMark() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z" />
    </svg>
  );
}

/** GitHub's mark, drawn in `currentColor` for the same reason. */
function GithubMark() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3-.405c1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

const OAUTH_PROVIDERS: ReadonlyArray<{
  Mark: () => ReactElement;
  label: string;
  strategy: AuthOAuthStrategy;
}> = [
  { Mark: GoogleMark, label: "Google", strategy: "oauth_google" },
  { Mark: GithubMark, label: "GitHub", strategy: "oauth_github" },
];

/**
 * The social half of an auth page: one button per provider, then the hairline
 * that hands the user down to the email form.
 *
 * Renders nothing at all when `NEXT_PUBLIC_ENABLE_OAUTH` is unset, so the page
 * collapses to a plain email form rather than showing dead controls.
 */
function OAuthButtons({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (strategy: AuthOAuthStrategy) => void;
}) {
  if (!IS_OAUTH_ENABLED) {
    return null;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        {OAUTH_PROVIDERS.map(({ Mark, label, strategy }) => (
          <Button
            className="w-full"
            disabled={disabled}
            key={strategy}
            onClick={() => onSelect(strategy)}
            type="button"
            variant="outline"
          >
            <Mark />
            Continue with {label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          or
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

export { type AuthOAuthStrategy, OAuthButtons };
