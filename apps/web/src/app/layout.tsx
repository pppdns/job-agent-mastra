import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppUpdateBanner } from "@/components/app-update-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Job Research Copilot",
  description: "Assess job listings and research the companies behind them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
        <AppUpdateBanner />
      </body>
    </html>
  );
}
