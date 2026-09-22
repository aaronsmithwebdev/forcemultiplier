import { CampaignSettings } from "@/components/campaign-settings";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CampaignSettings id={id} />;
}
