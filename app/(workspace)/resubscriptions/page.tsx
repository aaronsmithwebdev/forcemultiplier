import { MarketingResubscriptions } from "@/components/marketing-resubscriptions";
import { Resubscriptions } from "@/components/resubscriptions";

export default function Page() {
  return (
    <>
      <MarketingResubscriptions />
      <details className="card">
        <summary>Legacy Constant Contact resubscriptions</summary>
        <Resubscriptions />
      </details>
    </>
  );
}
