// eslint-disable-next-line simple-import-sort/imports
import "./globals.css";

import { ClerkProvider } from "@clerk/nextjs";
import clsx from "clsx";
import { ThemeProvider } from "next-themes";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeSwitcher } from "@/components/theme-switcher";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Sprig",
  description: "Grow and organize ideas with Sprig",
};

const geistSans = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

/**
 * Brand voice for Clerk's prebuilt cards. The dashboard application name is
 * lowercase ("sprig"), so the default "Sign in to {{applicationName}}" title
 * would carry miscased chrome; these strings keep the cards in the product's
 * sentence-case voice instead.
 */
const clerkLocalization = {
  signIn: {
    start: {
      title: "Welcome back",
      subtitle: "Sign in to keep growing your maps",
    },
  },
  signUp: {
    start: {
      title: "Create your account",
      subtitle: "Your first map is a single prompt away",
    },
  },
};

/**
 * Themes every prebuilt Clerk widget (SignIn, SignUp, UserButton) to The
 * Grove. Values reference the CSS custom properties from globals.css so both
 * themes resolve live in the DOM — no duplicated palette here.
 */
const clerkAppearance = {
  variables: {
    borderRadius: "0.75rem",
    colorBackground: "var(--card)",
    colorDanger: "var(--destructive)",
    colorInputBackground: "var(--card)",
    colorInputText: "var(--foreground)",
    colorNeutral: "var(--foreground)",
    colorPrimary: "var(--primary)",
    colorText: "var(--foreground)",
    colorTextOnPrimaryBackground: "var(--primary-foreground)",
    colorTextSecondary: "var(--muted-foreground)",
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
    fontSize: "0.9375rem",
  },
  elements: {
    /* Rest, not floating: the auth shell carries its own depth now, so the
       card sits on it rather than floating above it. Sheets round at 1rem
       while controls keep the tighter 0.75rem from `variables`. */
    card: {
      border: "1px solid var(--border)",
      borderRadius: "1rem",
      boxShadow: "var(--shadow-rest)",
    },
    formButtonPrimary: {
      height: "2.5rem",
      textTransform: "none",
      fontSize: "0.8125rem",
      fontWeight: "500",
    },
    formFieldInput: {
      border: "1px solid var(--line-strong)",
    },
    /* OAuth reads as a secondary action so moss stays on the widget's one
       primary action. */
    socialButtonsBlockButton: {
      backgroundColor: "var(--secondary)",
      border: "1px solid var(--line-strong)",
      color: "var(--secondary-foreground)",
      height: "2.5rem",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={clsx(
        geistSans.variable,
        geistMono.variable,
        "scrollbar-styles"
      )}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground h-screen w-screen relative overflow-hidden">
        {/* Request auth is isolated by page-level Suspense boundaries instead
            of making the root provider consume headers for every route. */}
        <ClerkProvider
          appearance={clerkAppearance}
          localization={clerkLocalization}
        >
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <ThemeSwitcher />
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
