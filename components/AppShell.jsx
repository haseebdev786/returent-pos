// SAVE AS: components/AppShell.jsx
"use client";

// Staff shell: sidebar drawer + sticky header + content area.
// Owns the mobile drawer state, Escape-to-close, and body scroll-lock
// while the drawer is open. Content is offset by the fixed sidebar on
// desktop (lg:pl-64) and capped at max-w-6xl.

import { useCallback, useEffect, useState } from "react";
import StaffSidebar from "@/components/StaffSidebar";
import StaffHeader from "@/components/StaffHeader";

export default function AppShell({ user, children }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  return (
    <div className="min-w-0 overflow-x-clip print:pl-0 lg:pl-64">
      <StaffSidebar user={user} open={open} onClose={close} />
      <StaffHeader user={user} onMenuClick={() => setOpen(true)} />
      <main className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
        {children}
      </main>
    </div>
  );
}
