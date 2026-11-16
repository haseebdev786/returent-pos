// SAVE AS: app/kitchen/page.jsx
// Kitchen display page. Server-rendered shell; roles admin, kitchen
// only (cashiers are redirected to /counter, riders to /delivery).
// Kitchen staff land here after login (see app/login/page.jsx). The live board is the
// client component/KitchenBoard.jsx, which polls /api/kitchen — the
// page itself loads no order data, so the board is always fresh.

import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/ui";
import KitchenBoard from "@/components/KitchenBoard";
import { getCurrentUser } from "@/lib/session";

export default async function KitchenPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "rider") redirect("/delivery");
  if (user.role === "cashier") redirect("/counter");
  if (!["admin", "kitchen"].includes(user.role)) redirect("/login");

  const shellUser = { name: user.name, email: user.email, role: user.role };

  return (
    <AppShell user={shellUser}>
      <div className="space-y-5">
        <PageHeader
          title="Kitchen"
          description="Active batches, oldest first. Advance each batch as it is prepared."
        />
        <KitchenBoard />
      </div>
    </AppShell>
  );
}
