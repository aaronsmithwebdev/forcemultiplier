import { CampaignEditor } from "@/components/campaign-editor";
import { requireSession } from "@/lib/auth";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, user] = await Promise.all([params, requireSession()]);
  return <CampaignEditor id={id} email={user.email || ""} />;
}
