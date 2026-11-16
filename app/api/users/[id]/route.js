// SAVE AS: app/api/users/[id]/route.js
// Single staff account API — admin only. PATCH changes role and/or
// isActive. Two guards keep the restaurant from locking itself out:
//   1. An admin cannot deactivate their own account (403).
//   2. The LAST active admin cannot be deactivated or moved to another
//      role (409) — promote someone else first.
// Deactivation takes effect on the next request because getCurrentUser
// treats inactive users as logged out.
//
// DELETE is deliberately not allowed (405): staff accounts are
// deactivated, never deleted, so order/payment history that references
// them (rider assignments, payment receivers) stays intact. Deleting
// the row would orphan that history.

import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";

const ROLES = ["admin", "cashier", "kitchen", "rider"];

// Safe fields only — never password hashes (they live on Account rows,
// which are never selected here).
const SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
};

async function getAdminOrResponse() {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: Response.json(
        { error: "Sign in required." },
        { status: 401 },
      ),
    };
  }
  if (!hasRole(user, "admin")) {
    return {
      response: Response.json(
        { error: "Admin access required." },
        { status: 403 },
      ),
    };
  }
  return { admin: user };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const { admin, response } = await getAdminOrResponse();
  if (response) return response;

  const target = await prisma.user.findUnique({
    where: { id },
    select: SAFE_SELECT,
  });
  if (!target) {
    return Response.json(
      { error: "Staff account not found." },
      { status: 404 },
    );
  }

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

  const hasRoleField = body.role !== undefined;
  const hasActiveField = body.isActive !== undefined;
  if (!hasRoleField && !hasActiveField) {
    return Response.json(
      { error: "Nothing to update. Send role and/or isActive." },
      { status: 400 },
    );
  }

  const errors = {};
  if (hasRoleField && !ROLES.includes(body.role)) {
    errors.role = "Role must be admin, cashier, kitchen or rider.";
  }
  if (hasActiveField && typeof body.isActive !== "boolean") {
    errors.isActive = "isActive must be true or false.";
  }
  if (Object.keys(errors).length > 0) {
    return Response.json(
      { error: "Staff account could not be updated.", errors },
      { status: 400 },
    );
  }

  const nextRole = hasRoleField ? body.role : target.role;
  const nextActive = hasActiveField ? body.isActive : target.isActive;

  // Guard 1: nobody deactivates their own account.
  if (id === admin.id && body.isActive === false) {
    return Response.json(
      { error: "You cannot deactivate your own account." },
      { status: 403 },
    );
  }

  // Guard 2: the last active admin keeps admin status.
  const removesAdmin =
    target.role === "admin" &&
    target.isActive &&
    (nextRole !== "admin" || nextActive === false);
  if (removesAdmin) {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: "admin", isActive: true, id: { not: id } },
    });
    if (otherActiveAdmins === 0) {
      return Response.json(
        {
          error:
            "This is the last active admin. Promote another staff member to admin first.",
        },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(hasRoleField ? { role: body.role } : {}),
      ...(hasActiveField ? { isActive: body.isActive } : {}),
    },
    select: SAFE_SELECT,
  });

  return Response.json({ user: updated });
}

export async function DELETE() {
  const { response } = await getAdminOrResponse();
  if (response) return response;
  return Response.json(
    {
      error:
        "Deleting staff accounts is not allowed. Deactivate the account instead.",
    },
    { status: 405 },
  );
}
