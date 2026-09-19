import { AppError } from "./errors";
import { supabase } from "./supabase";

export async function session() {
  const { data, error } = await (await supabase()).auth.getUser();
  return error ? null : data.user;
}
export async function requireSession() {
  const value = await session();
  if (!value) throw new AppError("Sign in to your workspace.", 401);
  return value;
}
export async function login(email: string, password: string) {
  const { error } = await (
    await supabase()
  ).auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new AppError("Email or password is incorrect.", 401);
}
export async function logout() {
  await (await supabase()).auth.signOut();
}
