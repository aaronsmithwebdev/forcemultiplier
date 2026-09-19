import { AudienceDetail } from "@/components/audience-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AudienceDetail id={id} />;
}
