// SAVE AS: app/signup/page.jsx
"use client";

// Staff signup. No shell — centered brand card. The FIRST account ever
// created becomes Admin automatically (see the hook in lib/auth.js);
// later accounts start as Cashier until an admin changes their role.
// After signup the session is re-read for the role, then staff land on
// their home page, same as login.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

function homeForRole(role) {
  if (role === "kitchen") return "/kitchen";
  if (role === "rider") return "/delivery";
  return "/dashboard";
}

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await authClient.signUp.email({ name, email, password });
      if (result?.error) {
        setError(result.error.message || "Sign-up failed. Please try again.");
        return;
      }
      const session = await authClient.getSession();
      const role = session?.data?.user?.role;
      router.push(homeForRole(role));
      router.refresh();
    } catch (err) {
      setError(err?.message || "Sign-up failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-12">
      <div className="card card-pad">
        <p className="text-center text-xs font-semibold tracking-widest text-brand-600 uppercase">
          Restaurant POS
        </p>
        <h1 className="mt-2 text-center text-2xl font-bold tracking-tight text-slate-900">
          Create staff account
        </h1>
        <p className="page-desc text-center">
          The first account becomes Admin. Later accounts start as Cashier.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error ? <p className="form-error">{error}</p> : null}
          <div>
            <label htmlFor="signup-name" className="label">
              Full name
            </label>
            <input
              id="signup-name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="input"
              placeholder="Your full name"
            />
          </div>
          <div>
            <label htmlFor="signup-email" className="label">
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="input"
              placeholder="you@restaurant.com"
            />
          </div>
          <div>
            <label htmlFor="signup-password" className="label">
              Password
            </label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input"
              placeholder="At least 8 characters"
            />
          </div>
          <button type="submit" disabled={busy} className="btn btn-primary btn-block btn-lg">
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="link">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
