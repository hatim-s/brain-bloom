// import { ThemeSwitcher } from "@/components/theme-switcher";
import "./globals.css";

import clsx from "clsx";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";

import { SidebarProvider } from "@/components/ui/sidebar";
import SupabaseProvider from "@/providers/SupabaseProvider";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Next.js and Supabase Starter Kit",
  description: "The fastest way to build apps with Next.js and Supabase",
};

const geistSans = Geist({
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={clsx(geistSans.className, "scrollbar-styles")}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground h-screen w-screen">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SupabaseProvider>
            <SidebarProvider>
              {children}
              {/* todo: add this again */}
              {/* <ThemeSwitcher /> */}
            </SidebarProvider>
          </SupabaseProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
