"use client";
import { Check } from "lucide-react";

const steps = [
  ["name", "Campaign name"],
  ["design", "Design email"],
  ["settings", "Email settings"],
  ["preview", "Review & send"],
] as const;

export function CampaignSteps({
  id,
  current,
}: {
  id: string;
  current: (typeof steps)[number][0];
}) {
  const currentIndex = steps.findIndex(([key]) => key === current);
  return (
    <ol className="campaign-steps" aria-label="Campaign creation progress">
      {steps.map(([key, label], index) => {
        const complete = index < currentIndex;
        const href =
          key === "name"
            ? "/campaigns"
            : `/campaigns/${id}/${key === "preview" ? "preview" : key}`;
        return (
          <li key={key} className={key === current ? "active" : ""}>
            <a href={href} aria-current={key === current ? "step" : undefined}>
              <span>{complete ? <Check size={14} /> : index + 1}</span>
              {label}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
