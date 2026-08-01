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
 * Google's mark in its own four brand colours.
 *
 * Provider marks are the one place brand colour is allowed past the one-accent
 * rule: a recoloured G reads as a counterfeit, and users scan these buttons by
 * logo before they read the label.
 */
function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3.02h3.88c2.27-2.09 3.54-5.17 3.54-8.89Z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.95-1.08 7.95-2.91l-3.88-3.02c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A11.99 11.99 0 0 0 12 24Z"
        fill="#34A853"
      />
      <path
        d="M5.27 14.27A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.55.38-2.27V6.64H1.28A11.99 11.99 0 0 0 0 12c0 1.94.46 3.77 1.28 5.36l3.99-3.09Z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.28 6.64l3.99 3.09C6.22 6.88 8.87 4.77 12 4.77Z"
        fill="#EA4335"
      />
    </svg>
  );
}

/**
 * GitHub's mark, drawn in `currentColor` — the brand itself is monochrome, so
 * inheriting ink keeps it correct in both the light and the dark theme.
 */
function GithubMark() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
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
 * These are secondary controls by design — a sunken fill with an actionable
 * hairline, never a moss fill. The One Voice Rule spends the single moss primary
 * on the page's own submit ("Sign in" / "Create account"); three green buttons
 * stacked would make the real next action invisible. Hover moves one tonal step
 * (deeper into the well in light, lifted in dark) rather than introducing colour.
 *
 * The marks are pinned to a fixed left inset rather than sitting in the flex
 * gap, so "Google" and "GitHub" do not drag their logos to two different
 * x-positions; the labels stay optically centred and the icons form one column.
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
            className="relative w-full border border-line-strong hover:bg-accent"
            disabled={disabled}
            key={strategy}
            onClick={() => onSelect(strategy)}
            size="lg"
            type="button"
            variant="secondary"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-4 flex items-center"
            >
              <Mark />
            </span>
            Continue with {label}
          </Button>
        ))}
      </div>

      {/* Sentence case, no tracking: the system has no uppercase labels, and a
          divider is the quietest thing on the card. */}
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span className="text-[0.8125rem] text-muted-foreground">
          or use your email
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

export { type AuthOAuthStrategy, OAuthButtons };
