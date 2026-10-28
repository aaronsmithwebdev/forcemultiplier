import { Ban, Check } from "lucide-react";
import { Badge } from "./common";
import { FooterPreview } from "./footer-preview";

export type FooterOption = {
  id: string;
  name: string;
  previewHtml: string;
  isDefault: boolean;
};

export function FooterPicker({
  footers,
  value,
  disabled = false,
  onChange,
}: {
  footers: FooterOption[];
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="campaign-footer-options">
      {[null, ...footers].map((footer) => {
        const selected = value === (footer?.id ?? null);
        return (
          <label
            className={`campaign-footer-option ${selected ? "selected" : ""}`}
            key={footer?.id ?? "none"}
          >
            <input
              type="radio"
              name="footerId"
              value={footer?.id ?? ""}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(footer?.id ?? null)}
            />
            {footer ? (
              <FooterPreview
                html={footer.previewHtml}
                title={`${footer.name} footer thumbnail`}
                className="footer-thumbnail"
              />
            ) : (
              <div className="footer-none-thumbnail" aria-hidden="true">
                <Ban size={24} strokeWidth={1.4} />
                <span>Design only</span>
              </div>
            )}
            <span>
              <strong>{footer?.name ?? "No footer"}</strong>
              {footer?.isDefault && <Badge tone="green">Default</Badge>}
              {selected && <Check size={16} aria-hidden="true" />}
            </span>
          </label>
        );
      })}
    </div>
  );
}
