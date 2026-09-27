import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import First100Content from "./first-100-content";

export const metadata = {
  title: "First 100 Users \u2014 Odesseus",
  description: "Join the first 100 Odesseus users and get lifetime benefits: free wallet top-ups, priority support, and direct access to the founding team.",
};

export default function First100Page() {
  return (
    <main className="marketing-page">
      <MarketingNav />
      <First100Content />
      <MarketingFooter />
    </main>
  );
}