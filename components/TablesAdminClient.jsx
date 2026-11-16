// SAVE AS: components/TablesAdminClient.jsx
"use client";

// Staff tables administration: create / edit / delete tables (admin
// only — the APIs enforce this server-side; cashiers see the list
// read-only), QR code links, and the open order running at each table.
// Table status is shown, never edited: occupancy is driven by orders.

import { useState } from "react";
import Link from "next/link";
import { formatPKR } from "@/lib/format";
import { Badge, EmptyState, Icon } from "@/components/ui";

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Request failed. Please try again.");
  }
  return data;
}

function emptyTableForm() {
  return { id: null, code: "", name: "", seats: "4", isActive: true };
}

function tableToForm(table) {
  return {
    id: table.id,
    code: table.code,
    name: table.name,
    seats: String(table.seats),
    isActive: table.isActive,
  };
}

export default function TablesAdminClient({ initialTables, isAdmin, currency }) {
  const [tables, setTables] = useState(initialTables);
  const [tableForm, setTableForm] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function loadTables() {
    const data = await api("/api/tables");
    setTables(data.tables);
  }

  async function saveTable(event) {
    event.preventDefault();
    if (!tableForm) return;
    setSaving(true);
    try {
      const seats = Number(tableForm.seats);
      if (!Number.isInteger(seats) || seats < 1) {
        throw new Error("Seats must be a whole number of 1 or more.");
      }
      const payload = {
        code: tableForm.code.trim(),
        name: tableForm.name.trim(),
        seats,
        isActive: tableForm.isActive,
      };
      if (tableForm.id) {
        await api(`/api/tables/${tableForm.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setNotice("Table saved.");
      } else {
        await api("/api/tables", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice("Table created.");
      }
      setError("");
      setTableForm(null);
      await loadTables();
    } catch (err) {
      setError(err?.message || "Could not save the table.");
      setNotice("");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTable(table) {
    if (
      !window.confirm(
        `Delete "${table.name}" (${table.code})? This cannot be undone. Tables with an open order cannot be deleted.`,
      )
    ) {
      return;
    }
    setBusyId(table.id);
    try {
      await api(`/api/tables/${table.id}`, { method: "DELETE" });
      await loadTables();
      setNotice("Table deleted.");
      setError("");
    } catch (err) {
      setError(err?.message || "Could not delete the table.");
      setNotice("");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {isAdmin ? (
        <div>
          <button
            type="button"
            onClick={() => setTableForm(emptyTableForm())}
            className="btn btn-primary btn-sm"
          >
            <Icon name="plus" className="h-4 w-4" />
            New table
          </button>
        </div>
      ) : null}

      {tableForm ? (
        <form
          onSubmit={saveTable}
          className="card card-pad space-y-3"
        >
          <h2 className="section-title">
            {tableForm.id ? "Edit table" : "New table"}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="table-code" className="label">
                Code * (appears in the QR link /t/CODE)
              </label>
              <input
                id="table-code"
                type="text"
                value={tableForm.code}
                maxLength={20}
                onChange={(event) =>
                  setTableForm({ ...tableForm, code: event.target.value })
                }
                className="input"
                placeholder="e.g. T1"
                required
              />
            </div>
            <div>
              <label htmlFor="table-name" className="label">
                Name *
              </label>
              <input
                id="table-name"
                type="text"
                value={tableForm.name}
                maxLength={100}
                onChange={(event) =>
                  setTableForm({ ...tableForm, name: event.target.value })
                }
                className="input"
                placeholder="e.g. Table 1"
                required
              />
            </div>
            <div>
              <label htmlFor="table-seats" className="label">
                Seats *
              </label>
              <input
                id="table-seats"
                type="number"
                value={tableForm.seats}
                min={1}
                step={1}
                onChange={(event) =>
                  setTableForm({ ...tableForm, seats: event.target.value })
                }
                className="input"
                required
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={tableForm.isActive}
              onChange={(event) =>
                setTableForm({ ...tableForm, isActive: event.target.checked })
              }
              className="h-4 w-4 accent-orange-600"
            />
            Active (customers can order by scanning this table&apos;s QR code)
          </label>
          {tableForm.id ? (
            <p className="form-note">
              Changing the code changes the QR link — reprint the QR code
              afterwards. Table status is set by orders and cannot be
              edited here.
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? "Saving…" : tableForm.id ? "Save table" : "Create table"}
            </button>
            <button
              type="button"
              onClick={() => setTableForm(null)}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {tables.length === 0 ? (
        <EmptyState
          icon="table"
          title="No tables yet"
          description={
            isAdmin
              ? "Create your first table to generate its QR ordering link."
              : "No tables have been set up yet. Ask an admin to add them."
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((table) => (
            <li key={table.id} className="card card-pad">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="section-title truncate">{table.name}</h2>
                  <p className="section-desc">
                    Code {table.code} · {table.seats} seat
                    {table.seats === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={table.status === "OCCUPIED" ? "amber" : "green"}>
                    {table.status === "OCCUPIED" ? "Occupied" : "Free"}
                  </Badge>
                  {!table.isActive ? (
                    <Badge tone="slate">Inactive</Badge>
                  ) : null}
                </span>
              </div>

              {table.openOrder ? (
                <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
                  Open order {table.openOrder.orderNumber} ·{" "}
                  {formatPKR(table.openOrder.grandTotal, currency)} ·{" "}
                  {table.openOrder.status}
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No open order.</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/tables/${table.id}/qr`}
                  className="btn btn-secondary btn-sm"
                >
                  <Icon name="qr" className="h-4 w-4" />
                  QR code
                </Link>
                <a
                  href={`/t/${table.code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  Open ordering link
                </a>
                {isAdmin ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setTableForm(tableToForm(table))}
                      className="btn btn-secondary btn-sm"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busyId === table.id}
                      onClick={() => deleteTable(table)}
                      className="btn btn-danger-outline btn-sm"
                    >
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
