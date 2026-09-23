import { notFound } from "next/navigation";
import { mobileScreens } from "@/lib/mobile/screen-map";

export default async function MobileScreenPreview({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  const { screen } = await params;
  if (!mobileScreens.some((item) => item.index === screen)) notFound();
  return <main aria-hidden="true" />;
}
