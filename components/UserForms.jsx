// SAVE AS: components/UserForms.jsx
// Staff account controls — create form plus the staff table with
// per-row role selectors and activate/deactivate buttons. Client
// component: every change goes through the /api/users endpoints and
// the list is reloaded from the API afterwards, so what is shown is
// always what the server stored. API error text is shown unchanged;
// nothing reports success unless the API said so. No password is ever
// displayed — the create form only takes a new password, masked.
// Deactivation asks for confirmation first and is blocked for your
// own account here as well as server-side; the last-active-admin
// guard lives server-side and its error is shown here if it fires.
"use client";

import { useState } from "react";
import { Badge, ROLE_LABELS, roleTone } from "@/components/ui";
import { formatDate } from "@/lib/format";

const ROLES = ["admin", "cashier", "kitchen", "rider"];

export default function UserForms({
  initialUsers,
  initialTotalPages,
  initialTotal,
  currentUserId,
}) {
  const [users, setUsers] = useState(initialUsers);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [total, setTotal] = useState(initialTotal);
  const [listError, setListError] = useState("");
  const [rowBusyId, setRowBusyId] = useState(null);
  const [rowError, setRowError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("cashier");
  const [createError, setCreateError] = useState("");
  const [createFieldErrors, setCreateFieldErrors] = useState({});
  const [createMessage, setCreateMessage] = useState("");
  const [createWarning, setCreateWarning] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadPage(nextPage) {
    setListError("");
    try {
      const response = await fetch(`/api/users?page=${nextPage}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setListError(data?.error || "Could not load staff accounts.");
        return;
      }
      setUsers(Array.isArray(data.users) ? data.users : []);
      setPage(data.page || nextPage);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total ?? 0);
    } catch (err) {
      setListError(err?.message || "Could not load staff accounts.");
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    setCreateError("");
    setCreateFieldErrors({});
    setCreateMessage("");
    setCreateWarning("");
    setCreating(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCreateError(data?.error || "Staff account could not be created.");
        setCreateFieldErrors(
          data?.errors && typeof data.errors === "object" ? data.errors : {},
        );
        return;
      }
      setCreateMessage(
        `Staff account created for ${data.user?.email || email.trim()}.`,
      );
      if (data.warning) setCreateWarning(data.warning);
      setName("");
      setEmail("");
      setPassword("");
      setRole("cashier");
      await loadPage(1);
    } catch (err) {
      setCreateError(err?.message || "Staff account could not be created.");
    } finally {
      setCreating(false);
    }
  }

  async function updateUser(target, patch) {
    setRowError("");
    setRowBusyId(target.id);
    try {
      const response = await fetch(
        `/api/users/${encodeURIComponent(target.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRowError(data?.error || "Could not update this account.");
        return;
      }
      setUsers((prev) =>
        prev.map((staff) => (staff.id === target.id ? data.user : staff)),
      );
    } catch (err) {
      setRowError(err?.message || "Could not update this account.");
    } finally {
      setRowBusyId(null);
    }
  }

  function handleRoleChange(target, nextRole) {
    if (nextRole === target.role) return;
    updateUser(target, { role: nextRole });
  }

  function handleToggleActive(target) {
    if (!target.isActive) {
      updateUser(target, { isActive: true });
      return;
    }
    const confirmed = window.confirm(
      `Deactivate ${target.name || target.email}? They will be signed out and cannot sign in again until reactivated.`,
    );
    if (confirmed) updateUser(target, { isActive: false });
  }

  function createFieldError(field) {
    return createFieldErrors[field] ? (
      <p className="field-error">{createFieldErrors[field]}</p>
    ) : null;
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="card card-pad space-y-4">
        <div>
          <h2 className="section-title">Create staff account</h2>
          <p className="section-desc">
            The new staff member signs in with this email and password.
          </p>
        </div>
        {createError ? <p className="form-error">{createError}</p> : null}
        {createMessage ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {createMessage}
          </p>
        ) : null}
        {createWarning ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {createWarning}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="user-create-name" className="label">
              Name
            </label>
            <input
              id="user-create-name"
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="input"
              placeholder="Full name"
            />
            {createFieldError("name")}
          </div>
          <div>
            <label htmlFor="user-create-email" className="label">
              Email
            </label>
            <input
              id="user-create-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="input"
              placeholder="staff@restaurant.com"
            />
            {createFieldError("email")}
          </div>
          <div>
            <label htmlFor="user-create-password" className="label">
              Password
            </label>
            <input
              id="user-create-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input"
              placeholder="At least 8 characters"
            />
            {createFieldError("password")}
          </div>
          <div>
            <label htmlFor="user-create-role" className="label">
              Role
            </label>
            <select
              id="user-create-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="input"
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABELS[option] ?? option}
                </option>
              ))}
            </select>
            {createFieldError("role")}
          </div>
        </div>
        <button type="submit" disabled={creating} className="btn btn-primary">
          {creating ? "Creating…" : "Create account"}
        </button>
      </form>

      <section className="card card-pad">
        <h2 className="section-title">Staff accounts</h2>
        <p className="section-desc">
          Change a role with the selector. Deactivated accounts cannot sign
          in. Accounts are never deleted.
        </p>
        {listError ? <p className="form-error mt-3">{listError}</p> : null}
        {rowError ? <p className="form-error mt-3">{rowError}</p> : null}
        {users.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            No staff accounts found.
          </p>
        ) : (
          <>
            <div className="table-wrap mt-3">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((staff) => {
                    const isSelf = staff.id === currentUserId;
                    const busy = rowBusyId === staff.id;
                    return (
                      <tr key={staff.id}>
                        <td className="font-medium">
                          {staff.name}
                          {isSelf ? (
                            <span className="block text-xs font-normal text-slate-500">
                              You
                            </span>
                          ) : null}
                        </td>
                        <td>{staff.email}</td>
                        <td>
                          <select
                            aria-label={`Role for ${staff.name || staff.email}`}
                            value={staff.role}
                            disabled={busy}
                            onChange={(event) =>
                              handleRoleChange(staff, event.target.value)
                            }
                            className="input w-auto"
                          >
                            {ROLES.map((option) => (
                              <option key={option} value={option}>
                                {ROLE_LABELS[option] ?? option}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <Badge tone={staff.isActive ? "green" : "slate"}>
                            {staff.isActive ? "Active" : "Inactive"}
                          </Badge>
                          <span className="mt-1 block">
                            <Badge tone={roleTone(staff.role)}>
                              {ROLE_LABELS[staff.role] ?? staff.role}
                            </Badge>
                          </span>
                        </td>
                        <td>{formatDate(staff.createdAt)}</td>
                        <td>
                          {staff.isActive ? (
                            <button
                              type="button"
                              disabled={busy || isSelf}
                              title={
                                isSelf
                                  ? "You cannot deactivate your own account."
                                  : undefined
                              }
                              onClick={() => handleToggleActive(staff)}
                              className="btn btn-danger-outline btn-sm"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleToggleActive(staff)}
                              className="btn btn-secondary btn-sm"
                            >
                              Reactivate
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-600">
                Page {page} of {totalPages} · {total}{" "}
                {total === 1 ? "account" : "accounts"}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => loadPage(page - 1)}
                  className="btn btn-secondary btn-sm"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => loadPage(page + 1)}
                  className="btn btn-secondary btn-sm"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
