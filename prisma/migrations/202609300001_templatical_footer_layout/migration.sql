ALTER TABLE "forcemultiplier"."EmailFooter"
ADD COLUMN "content" JSONB;

UPDATE "forcemultiplier"."EmailFooter"
SET "content" = jsonb_build_object(
  'blocks', jsonb_build_array(jsonb_build_object(
    'id', 'legacy-footer-' || "id",
    'type', 'html',
    'content', "html",
    'styles', jsonb_build_object(
      'padding', jsonb_build_object('top', 10, 'right', 10, 'bottom', 10, 'left', 10)
    )
  )),
  'settings', jsonb_build_object(
    'width', 600,
    'backgroundColor', '#ffffff',
    'textColor', '#1a1a1a',
    'linkUnderline', true,
    'fontFamily', 'Arial',
    'locale', 'en'
  )
);

UPDATE "forcemultiplier"."EmailFooter"
SET "content" = '{
  "blocks": [{
    "id": "default-footer-section",
    "type": "section",
    "columns": "1",
    "children": [[{
      "id": "default-footer-copy",
      "type": "paragraph",
      "content": "<p style=\"text-align:center\"><strong style=\"color:#1d3029;font-size:12px\">Mito Foundation</strong></p><p style=\"text-align:center\"><span style=\"color:#5f6e66;font-size:12px\">Supporting the mitochondrial disease community.</span></p><p style=\"text-align:center\"><a href=\"https://www.mito.org.au\" style=\"font-size:12px\">mito.org.au</a></p>",
      "styles": {"padding": {"top": 0, "right": 0, "bottom": 0, "left": 0}}
    }]],
    "styles": {"padding": {"top": 24, "right": 20, "bottom": 24, "left": 20}},
    "border": {
      "top": {"width": 1, "style": "solid", "color": "#dfe5dc"},
      "right": {"width": 0, "style": "solid", "color": "#dfe5dc"},
      "bottom": {"width": 0, "style": "solid", "color": "#dfe5dc"},
      "left": {"width": 0, "style": "solid", "color": "#dfe5dc"}
    }
  }],
  "settings": {
    "width": 600,
    "backgroundColor": "#ffffff",
    "textColor": "#1a1a1a",
    "linkUnderline": true,
    "fontFamily": "Arial",
    "locale": "en"
  }
}'::jsonb
WHERE "id" = 'default-footer';

ALTER TABLE "forcemultiplier"."EmailFooter"
ALTER COLUMN "content" SET NOT NULL,
DROP COLUMN "html";

ALTER TABLE "forcemultiplier"."CampaignSend"
ADD COLUMN "footerContent" JSONB;

UPDATE "forcemultiplier"."CampaignSend"
SET "footerContent" = jsonb_build_object(
  'blocks', jsonb_build_array(jsonb_build_object(
    'id', 'sent-footer-' || "id",
    'type', 'html',
    'content', "footerHtml",
    'styles', jsonb_build_object(
      'padding', jsonb_build_object('top', 10, 'right', 10, 'bottom', 10, 'left', 10)
    )
  )),
  'settings', jsonb_build_object(
    'width', 600,
    'backgroundColor', '#ffffff',
    'textColor', '#1a1a1a',
    'linkUnderline', true,
    'fontFamily', 'Arial',
    'locale', 'en'
  )
);

ALTER TABLE "forcemultiplier"."CampaignSend"
ALTER COLUMN "footerContent" SET NOT NULL,
DROP COLUMN "footerHtml";
