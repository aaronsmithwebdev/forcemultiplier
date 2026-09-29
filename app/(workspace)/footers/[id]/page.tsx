import { FooterEditor } from "@/components/footer-editor";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FooterEditor id={id} />;
}
