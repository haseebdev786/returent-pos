// SAVE AS: app/login/page.jsx
"use client";

// Staff login. No shell — centered brand card. After sign-in the session
// is re-read to get the database role, then staff land on their home:
// kitchen -> /kitchen, rider -> /delivery, cashier -> /counter,
// admin -> /dashboard. Real error messages are shown; nothing is masked.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

function homeForRole(role) {
  if (role === "kitchen") return "/kitchen";
  if (role === "rider") return "/delivery";
  if (role === "cashier") return "/orders/new";
  return "/dashboard";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result?.error) {
        setError(result.error.message || "Sign-in failed. Check your details and try again.");
        return;
      }
      // Role lives in the database, so fetch the fresh session before
      // choosing the landing page.
      const session = await authClient.getSession();
      const role = session?.data?.user?.role;
      router.push(homeForRole(role));
      router.refresh();
    } catch (err) {
      setError(err?.message || "Sign-in failed. Please try again.");
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
          Staff login
        </h1>
        <p className="page-desc text-center">
          Sign in with your staff email and password.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error ? <p className="form-error">{error}</p> : null}
          <div>
            <label htmlFor="login-email" className="label">
              Email
            </label>
            <input
              id="login-email"
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
            <label htmlFor="login-password" className="label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input"
              placeholder="Your password"
            />
          </div>
          <button type="submit" disabled={busy} className="btn btn-primary btn-block btn-lg">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          No account yet?{" "}
          <Link href="/signup" className="link">
            Create the first account
          </Link>
        </p>
      </div>
    </main>
  );
}
