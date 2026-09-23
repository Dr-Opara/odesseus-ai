import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";
import ReferralCapture from "@/components/referral-capture";
import PwaRegistration from "@/components/pwa-registration";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
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
  return <html lang="en" className={fraunces.variable}><body><ReferralCapture /><PwaRegistration />{children}</body></html>;
}
