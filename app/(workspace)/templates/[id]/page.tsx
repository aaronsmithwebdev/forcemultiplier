import { TemplateEditor } from "@/components/template-editor";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TemplateEditor id={id} />;
}
