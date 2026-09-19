"use client";
import { useState } from "react";
import { ArrowUpRight, Layers3, ShieldCheck, ArrowRight } from "lucide-react";
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
      <section className="login-story">
        <div className="brand">
          <span className="brand-symbol">
            <Layers3 size={23} />
          </span>
          ForceMultiplier
        </div>
        <div>
          <div className="eyebrow">A MORE CONNECTED WORKDAY</div>
          <h1>
            The right people.
            <br />
            The right lists.
            <br />
            <em>One workspace.</em>
          </h1>
          <p>
            Bring your Salesforce audiences and Constant Contact lists together,
            with the details that make every connection count.
          </p>
          <div className="connection-graphic">
            <span className="provider-logo salesforce">sf</span>
            <span className="graphic-line" />
            <ArrowUpRight />
            <span className="graphic-line" />
            <span className="provider-logo constant-contact">cc</span>
          </div>
        </div>
        <div className="login-foot">
          <ShieldCheck size={17} /> A private workspace for your team
        </div>
      </section>
      <section className="login-form">
        <div className="form-width">
          <div className="eyebrow">LET’S GET CONNECTED</div>
          <h2>Welcome back</h2>
          <p>Sign in with the user managed in your Supabase project.</p>
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
          <p className="login-note">
            Your Salesforce and Constant Contact credentials are configured
            after you sign in.
          </p>
        </div>
      </section>
    </main>
  );
}
