"use client";
import { useState } from "react";
import { ArrowRight, Layers3 } from "lucide-react";
import { api, Button, Notice } from "./common";
export function LoginForm({ initialError }: { initialError: string }) {
  const [error, setError] = useState(initialError),
    [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("auth/login", "POST", data);
      window.location.assign("/connections");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-form">
        <div className="form-width">
          <div className="brand">
            <span className="brand-symbol">
              <Layers3 size={23} />
            </span>
            ForceMultiplier
          </div>
          <h1>Sign in</h1>
          <Notice message={error} />
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                placeholder="you@yourcompany.com"
                required
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                maxLength={128}
                autoComplete="current-password"
              />
            </label>
            <Button type="submit" busy={busy} disabled={!!initialError}>
              Sign in
              <ArrowRight size={17} />
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
