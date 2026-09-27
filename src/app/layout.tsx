import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import ReferralCapture from "@/components/referral-capture";
import PwaRegistration from "@/components/pwa-registration";
import MobileRouteExperience from "@/components/mobile-route-experience";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// The mobile design system (see the `m-` rules in globals.css) is set in
// Inter. Without this the whole mobile stack silently fell back to Arial, so
// the approved mobile screens were never rendering in their intended typeface.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Odesseus — Your next move, handled.",
  description: "Discover, tailor, apply, track, and interview with one connected career workspace.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Odesseus",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e0e1f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${fraunces.variable} ${inter.variable}`}><body><ReferralCapture /><PwaRegistration /><MobileRouteExperience>{children}</MobileRouteExperience></body></html>;
}
