// SAVE AS: app/api/settings/route.js
// Settings API — admin only, both methods. GET returns the full
// singleton Settings row (including publicUrl) for the admin settings
// form. Public pages must NEVER call this API; they read Settings
// server-side via getPublicSettings (lib/settings-data.js), which
// returns the same merged values without an admin session.
//
// PATCH validates every provided field, merges over the current
// Settings, and upserts the singleton row (id = 1). Validation always
// runs against the merged result, so a partial PATCH can never leave
// the restaurant name or currency empty. On success both caches are
// invalidated: Settings (values changed) and the menu (totals and the
// table-QR public URL are read through cached menu data). Errors are
// honest: 400 with a per-field errors map, never a fake success.

import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { invalidateMenu, invalidateSettings } from "@/lib/cache";

function pickSettings(settings) {
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

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!hasRole(user, "admin")) {
    return Response.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }
  return null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Accept a JSON integer or a digit-only string; reject floats,
 * booleans, null and anything else so "5.5" can never silently become
 * 5. Returns { ok: true, value } or { ok: false }.
 */
function parseIntegerField(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return { ok: Number.isSafeInteger(value), value };
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return { ok: true, value: parsed };
  }
  return { ok: false };
}

/**
 * Optional text field: null/undefined/blank becomes null; otherwise a
 * trimmed string within maxLength, or an error message string.
 */
function parseOptionalText(value, maxLength) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > maxLength) return { ok: false };
  return { ok: true, value: trimmed };
}

function parsePublicUrl(value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > 500) return { ok: false };
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false };
  }
  if (url.username || url.password) return { ok: false };
  return { ok: true, value: trimmed };
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const settings = await getSettings();
  return Response.json({ settings: pickSettings(settings) });
}

export async function PATCH(request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  if (!isPlainObject(body)) {
    return Response.json(
      { error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  const errors = {};
  const merged = pickSettings(await getSettings());

  // Restaurant name: required, non-empty, at most 100 characters.
  if (body.restaurantName !== undefined) {
    const parsed = parseOptionalText(body.restaurantName, 100);
    if (!parsed.ok || parsed.value === null) {
      errors.restaurantName = "Restaurant name is required.";
    } else {
      merged.restaurantName = parsed.value;
    }
  }

  // Address / phone: optional text, blank means "not set".
  if (body.address !== undefined) {
    const parsed = parseOptionalText(body.address, 500);
    if (!parsed.ok) {
      errors.address = "Address must be 500 characters or fewer.";
    } else {
      merged.address = parsed.value;
    }
  }
  if (body.phone !== undefined) {
    const parsed = parseOptionalText(body.phone, 50);
    if (!parsed.ok) {
      errors.phone = "Phone must be 50 characters or fewer.";
    } else {
      merged.phone = parsed.value;
    }
  }

  // Currency: required, non-empty short label (e.g. "Rs").
  if (body.currency !== undefined) {
    const parsed = parseOptionalText(body.currency, 10);
    if (!parsed.ok || parsed.value === null) {
      errors.currency = "Currency is required (a short label, e.g. Rs).";
    } else {
      merged.currency = parsed.value;
    }
  }

  // Rates: whole numbers, 0–100.
  if (body.taxRate !== undefined) {
    const parsed = parseIntegerField(body.taxRate);
    if (!parsed.ok || parsed.value < 0 || parsed.value > 100) {
      errors.taxRate = "Tax rate must be a whole number between 0 and 100.";
    } else {
      merged.taxRate = parsed.value;
    }
  }
  if (body.serviceChargeRate !== undefined) {
    const parsed = parseIntegerField(body.serviceChargeRate);
    if (!parsed.ok || parsed.value < 0 || parsed.value > 100) {
      errors.serviceChargeRate =
        "Service charge rate must be a whole number between 0 and 100.";
    } else {
      merged.serviceChargeRate = parsed.value;
    }
  }

  // Enabled flags: real booleans only.
  if (body.taxEnabled !== undefined) {
    if (typeof body.taxEnabled !== "boolean") {
      errors.taxEnabled = "Tax enabled must be true or false.";
    } else {
      merged.taxEnabled = body.taxEnabled;
    }
  }
  if (body.serviceChargeEnabled !== undefined) {
    if (typeof body.serviceChargeEnabled !== "boolean") {
      errors.serviceChargeEnabled =
        "Service charge enabled must be true or false.";
    } else {
      merged.serviceChargeEnabled = body.serviceChargeEnabled;
    }
  }

  // Money fields: whole PKR, 0 or more.
  if (body.deliveryFee !== undefined) {
    const parsed = parseIntegerField(body.deliveryFee);
    if (!parsed.ok || parsed.value < 0) {
      errors.deliveryFee = "Delivery fee must be a whole number of 0 or more.";
    } else {
      merged.deliveryFee = parsed.value;
    }
  }
  if (body.freeDeliveryThreshold !== undefined) {
    const parsed = parseIntegerField(body.freeDeliveryThreshold);
    if (!parsed.ok || parsed.value < 0) {
      errors.freeDeliveryThreshold =
        "Free delivery threshold must be a whole number of 0 or more.";
    } else {
      merged.freeDeliveryThreshold = parsed.value;
    }
  }
  if (body.minOrderAmount !== undefined) {
    const parsed = parseIntegerField(body.minOrderAmount);
    if (!parsed.ok || parsed.value < 0) {
      errors.minOrderAmount =
        "Minimum order amount must be a whole number of 0 or more.";
    } else {
      merged.minOrderAmount = parsed.value;
    }
  }

  // Public URL: empty (not set) or a valid http(s) URL.
  if (body.publicUrl !== undefined) {
    const parsed = parsePublicUrl(body.publicUrl);
    if (!parsed.ok) {
      errors.publicUrl =
        "Public URL must be empty or a valid http(s) URL.";
    } else {
      merged.publicUrl = parsed.value;
    }
  }

  // Receipt footer: optional text, blank means "not set".
  if (body.receiptFooter !== undefined) {
    const parsed = parseOptionalText(body.receiptFooter, 500);
    if (!parsed.ok) {
      errors.receiptFooter = "Receipt footer must be 500 characters or fewer.";
    } else {
      merged.receiptFooter = parsed.value;
    }
  }

  // Final guard: the merged row must always keep a name and currency,
  // even if the stored row was somehow invalid before this request.
  if (!merged.restaurantName) {
    errors.restaurantName = "Restaurant name is required.";
  }
  if (!merged.currency) {
    errors.currency = "Currency is required (a short label, e.g. Rs).";
  }

  if (Object.keys(errors).length > 0) {
    return Response.json(
      {
        error: "Settings could not be saved. Check the highlighted fields.",
        errors,
      },
      { status: 400 },
    );
  }

  const updated = await prisma.setting.upsert({
    where: { id: 1 },
    update: { ...merged },
    create: { id: 1, ...merged },
  });

  // Totals and the table-QR public URL flow through cached reads, so
  // both caches go: stale Settings or a stale menu would keep serving
  // the old rates/URL for up to the cache TTL.
  await invalidateSettings();
  await invalidateMenu();

  return Response.json({ settings: pickSettings(updated) });
}
