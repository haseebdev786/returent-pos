// SAVE AS: components/LogoutButton.jsx
"use client";

// Sign-out button. The handler is identical for both variants — only the
// styling differs: "light" (default) for headers, "dark" for the dark
// sidebar drawer.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Icon } from "@/components/ui";

export default function LogoutButton({ variant = "light", className = "" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await authClient.signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const classes =
    variant === "dark" ? "side-logout" : "btn btn-secondary btn-sm";

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      className={`${classes} ${className}`.trim()}
    >
      <Icon name="logout" className="h-4 w-4" />
      {busy ? "Signing out…" : "Logout"}
    </button>
  );
}
