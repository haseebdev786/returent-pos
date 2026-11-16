// SAVE AS: app/order/[id]/page.jsx
// Public order tracking page: /order/123?token=<accessToken>. No login.
// The token is validated server-side (constant-time compare) before any
// order detail renders; a bad token gets an honest 403 page and an
// unknown id an honest 404 page — never a redirect loop, never partial
// data. The published menu is also passed so the tracking client can
// offer "add more" while the order is still changeable. canAdd is
// computed server-side from type + status + payment status; the client
// re-derives it from polled status as the order advances.

import { timingSafeEqual } from "node:crypto";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getPublicSettings } from "@/lib/settings-data";
import { getPublishedMenu } from "@/lib/menu-data";
import OrderTrackingClient from "@/components/OrderTrackingClient";

const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY"];

function tokensMatch(provided, actual) {
  if (typeof provided !== "string" || typeof actual !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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

function serializeOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    type: order.type,
    status: order.status,
    paymentStatus: order.paymentStatus,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryAddress: order.deliveryAddress,
    subtotal: order.subtotal,
    discount: order.discount,
    tax: order.tax,
    serviceCharge: order.serviceCharge,
    deliveryFee: order.deliveryFee,
    grandTotal: order.grandTotal,
    discountReason: order.discountReason,
    waiterCalledAt: order.waiterCalledAt?.toISOString() ?? null,
    billRequestedAt: order.billRequestedAt?.toISOString() ?? null,
    cancelledReason: order.cancelledReason,
    notes: order.notes,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    table: order.table
      ? { id: order.table.id, code: order.table.code, name: order.table.name }
      : null,
    batches: order.batches.map((batch) => ({
      id: batch.id,
      batchNumber: batch.batchNumber,
      status: batch.status,
      createdAt: batch.createdAt.toISOString(),
      items: batch.items.map((item) => ({
        id: item.id,
        itemName: item.itemName,
        variantName: item.variantName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        note: item.note,
        lineTotal: item.lineTotal,
        addons: item.addons.map((addon) => ({
          id: addon.id,
          addonName: addon.addonName,
          price: addon.price,
        })),
      })),
    })),
  };
}

function ErrorPage({ restaurantName, title, description }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <div className="card card-pad text-center">
        <p className="text-xs font-semibold tracking-widest text-brand-600 uppercase">
          {restaurantName}
        </p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">{title}</h1>
        <p className="page-desc">{description}</p>
        <Link href="/order" className="btn btn-primary mt-5">
          Order online
        </Link>
      </div>
    </main>
  );
}

export default async function OrderTrackingPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const token = typeof query?.token === "string" ? query.token : "";
  const orderId = Number(id);

  const [settings, menu] = await Promise.all([
    getPublicSettings(),
    getPublishedMenu(),
  ]);
  const plain = plainSettings(settings);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return (
      <ErrorPage
        restaurantName={plain.restaurantName}
        title="Order not found"
        description="We could not find that order. Check the link and try again."
      />
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      table: true,
      batches: {
        orderBy: { batchNumber: "asc" },
        include: { items: { include: { addons: true } } },
      },
    },
  });

  if (!order) {
    return (
      <ErrorPage
        restaurantName={plain.restaurantName}
        title="Order not found"
        description="We could not find that order. Check the link and try again."
      />
    );
  }

  if (!tokensMatch(token, order.accessToken)) {
    return (
      <ErrorPage
        restaurantName={plain.restaurantName}
        title="Invalid tracking link"
        description="This tracking link is not valid for this order. Please use the link you received when the order was placed."
      />
    );
  }

  const canAdd =
    order.paymentStatus === "UNPAID" &&
    (order.type === "DINE_IN"
      ? OPEN_STATUSES.includes(order.status)
      : order.status === "RECEIVED");

  return (
    <OrderTrackingClient
      order={serializeOrder(order)}
      menu={menu}
      settings={plain}
      token={token}
      canAdd={canAdd}
    />
  );
}
