// SAVE AS: app/api/users/route.js
// Staff accounts API — admin only, both methods. GET lists staff
// (paginated, 20 per page) with safe fields only: password hashes live
// on the Account table and are never selected or returned.
//
// POST creates a staff account. HOW IT WORKS (read before changing):
// the password MUST be hashed by Better Auth — this route never hashes
// anything itself and there is deliberately no second hashing path.
// It calls the Better Auth server API:
//   auth.api.signUpEmail({ body: { name, email, password }, headers })
// with a minimal Headers object (signUpEmail expects request headers
// for its context; no real request headers are forwarded). The role
// and isActive columns are declared input:false in lib/auth.js, so
// signUpEmail cannot set them — the route then updates the created row
// with Prisma to apply the requested role and isActive: true. If the
// role update fails, the account still exists with the default role
// and the 201 response carries a `warning` saying so, instead of
// pretending the requested role was applied.
// The new account's session row is created by signUpEmail, but no
// cookie is set on the admin's browser, so the admin stays signed in
// as themselves. The first-user-becomes-admin hook in lib/auth.js
// cannot fire here: the calling admin already exists, so the user
// count is at least 2 when the new row lands.
// FALLBACK RISK: this depends on auth.api.signUpEmail being available
// at runtime in the installed better-auth version. If it ever throws
// an "is not a function" style error, the honest fallback is for the
// admin to create the account via /signup and then change its role
// with PATCH /api/users/[id] — do NOT invent a manual hashing path to
// work around it. Duplicate emails return 409, checked case-insensitively
// before calling Better Auth and again from its error if it rejects.

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getCurrentUser, hasRole } from "@/lib/session";

const ROLES = ["admin", "cashier", "kitchen", "rider"];
const PAGE_SIZE = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Safe fields only — never id-adjacent secrets, never Account rows.
const SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
};

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

export async function GET(request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const requestedPage = Number.parseInt(
    new URL(request.url).searchParams.get("page") || "1",
    10,
  );
  const total = await prisma.user.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, totalPages)
      : 1;

  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: SAFE_SELECT,
  });

  return Response.json({ users, page, totalPages, total });
}

export async function POST(request) {
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = body.password;
  const role = body.role;

  const errors = {};
  if (!name || name.length > 100) {
    errors.name = "Name is required.";
  }
  if (!EMAIL_RE.test(email)) {
    errors.email = "A valid email address is required.";
  }
  if (typeof password !== "string" || password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  } else if (password.length > 128) {
    errors.password = "Password must be 128 characters or fewer.";
  }
  if (!ROLES.includes(role)) {
    errors.role = "Role must be admin, cashier, kitchen or rider.";
  }
  if (Object.keys(errors).length > 0) {
    return Response.json(
      { error: "Staff account could not be created.", errors },
      { status: 400 },
    );
  }

  // Duplicate check first, case-insensitive, so the common case gets a
  // clean 409 instead of a Better Auth error shape.
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) {
    return Response.json(
      { error: "A staff account with this email already exists." },
      { status: 409 },
    );
  }

  let createdId = null;
  try {
    const result = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: new Headers(),
    });
    // Better Auth's return shape has varied across versions; read the
    // id from the documented shape and fall back to a lookup below.
    createdId = result?.user?.id ?? result?.data?.user?.id ?? null;
  } catch (error) {
    const detail = `${error?.code ?? ""} ${error?.body?.code ?? ""} ${error?.message ?? ""}`;
    if (/already exists|USER_ALREADY_EXISTS|already registered/i.test(detail)) {
      return Response.json(
        { error: "A staff account with this email already exists." },
        { status: 409 },
      );
    }
    return Response.json(
      {
        error: `Could not create the staff account: ${error?.message || "Unknown error."}`,
      },
      { status: 500 },
    );
  }

  if (!createdId) {
    const created = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    createdId = created?.id ?? null;
  }
  if (!createdId) {
    return Response.json(
      {
        error:
          "The account may not have been created. Check the staff list before trying again.",
      },
      { status: 500 },
    );
  }

  // signUpEmail cannot set role/isActive (input: false), so apply them
  // with Prisma. A failure here must not fake the requested role.
  let warning;
  try {
    await prisma.user.update({
      where: { id: createdId },
      data: { role, isActive: true },
    });
  } catch {
    warning =
      "Account created, but the role could not be set. Use the role selector to set it.";
  }

  const createdUser = await prisma.user.findUnique({
    where: { id: createdId },
    select: SAFE_SELECT,
  });
  if (!createdUser) {
    return Response.json(
      {
        error:
          "The account may not have been created. Check the staff list before trying again.",
      },
      { status: 500 },
    );
  }
  if (!warning && createdUser.role !== role) {
    warning =
      "Account created with the default role. Use the role selector to change it.";
  }

  return Response.json(
    { user: createdUser, ...(warning ? { warning } : {}) },
    { status: 201 },
  );
}
