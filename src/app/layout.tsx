import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";
import ReferralCapture from "@/components/referral-capture";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Odesseus — Your next move, handled.",
  description: "Discover, tailor, apply, track, and interview with one connected career workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={fraunces.variable}><body><ReferralCapture />{children}</body></html>;
}
