import Link from "next/link";
import { AudienceImport } from "@/components/audience-import";
import { Heading } from "@/components/common";
export default function Page() {
  return (
    <>
      <Link className="back-link" href="/audiences">
        Back to audiences
      </Link>
      <Heading title="Import an audience" />
      <AudienceImport />
    </>
  );
}
