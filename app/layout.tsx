// import { ThemeSwitcher } from "@/components/theme-switcher";
// eslint-disable-next-line simple-import-sort/imports
import "./globals.css";

import { ClerkProvider } from "@clerk/nextjs";
import clsx from "clsx";
import { ThemeProvider } from "next-themes";
import { Geist, Geist_Mono } from "next/font/google";

import { SidebarProvider } from "@/components/sidebar/sidebar-provider";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Toaster } from "@/components/ui/sonner";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

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
        <ClerkProvider dynamic>
          <ConvexClientProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="dark"
              enableSystem
              disableTransitionOnChange
            >
              <Toaster position="bottom-right" richColors expand />
              <SidebarProvider>
                {children}
                <ThemeSwitcher />
              </SidebarProvider>
            </ThemeProvider>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
