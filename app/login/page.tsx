import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
export const dynamic = "force-dynamic";
export default async function Login() {
  let error = "";
  try {
    if (await session()) redirect("/audiences");
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    error = e instanceof Error ? e.message : "Supabase Auth is unavailable.";
  }
  return <LoginForm initialError={error} />;
}
