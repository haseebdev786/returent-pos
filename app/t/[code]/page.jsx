// SAVE AS: app/t/[code]/page.jsx
// QR table ordering page: /t/T1. No login — the QR code on the table is
// the entry point. Loads the table (404 when the code is unknown or the
// table is inactive), the public Settings, the published menu, and the
// table's open-order SUMMARY (order number / status / total only — the
// accessToken is never passed to this page; the device that placed the
// order holds it in localStorage). All ordering UI lives in
// components/TableOrderClient.jsx.

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPublicSettings } from "@/lib/settings-data";
import { getPublishedMenu } from "@/lib/menu-data";
import TableOrderClient from "@/components/TableOrderClient";

const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY"];

function plainSettings(settings) {
  return {
    restaurantName: settings.restaurantName,
    address: settings.address ?? null,
    phone: settings.phone ?? null,
    currency: settings.currency,
    taxRate: settings.taxRate,
    taxEnabled: settings.taxEnabled,
    serviceChargeRate: settings.serviceChargeRate,
    serviceChargeEnabled: settings.serviceChargeEnabled,
    deliveryFee: settings.deliveryFee,
    freeDeliveryThreshold: settings.freeDeliveryThreshold,
    minOrderAmount: settings.minOrderAmount,
    publicUrl: settings.publicUrl ?? null,
    receiptFooter: settings.receiptFooter ?? null,
  };
}

export default async function TableOrderPage({ params }) {
  const { code } = await params;

  const table = await prisma.table.findUnique({ where: { code } });
  if (!table || !table.isActive) notFound();

  const [settings, menu, openOrder] = await Promise.all([
    getPublicSettings(),
    getPublishedMenu(),
    prisma.order.findFirst({
      where: {
        tableId: table.id,
        status: { in: OPEN_STATUSES },
        paymentStatus: "UNPAID",
      },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { items: true } } },
    }),
  ]);

  return (
    <TableOrderClient
      menu={menu}
      settings={plainSettings(settings)}
      table={{
        id: table.id,
        code: table.code,
        name: table.name,
        seats: table.seats,
      }}
      openOrder={
        openOrder
          ? {
              id: openOrder.id,
              orderNumber: openOrder.orderNumber,
              status: openOrder.status,
              grandTotal: openOrder.grandTotal,
              itemCount: openOrder._count.items,
            }
          : null
      }
    />
  );
}
