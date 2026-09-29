import { createSlotBlock, type TemplateContent } from "@templatical/types";

export function footerLayout(
  content: TemplateContent,
  footer: TemplateContent,
): TemplateContent {
  if (!footer.blocks.length)
    throw new Error("Email footer content is required.");
  return {
    settings: content.settings,
    blocks: [createSlotBlock(), ...footer.blocks],
  };
}
