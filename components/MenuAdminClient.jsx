// SAVE AS: components/MenuAdminClient.jsx
"use client";

// Staff menu administration: categories, addon groups, and items with
// variants + addon-group links. All mutations go through the /api/menu
// APIs (admin-only, enforced server-side); this client only renders
// honest save/error states. Item search/filter/pagination is
// server-side via the paginated items API. Image entry is a URL field
// ONLY — there is no image upload in this app.

import { useEffect, useRef, useState } from "react";
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

function parseIntField(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${label} must be a whole number.`);
  return n;
}

function emptyItemForm(firstCategoryId) {
  return {
    id: null,
    categoryId: firstCategoryId ? String(firstCategoryId) : "",
    name: "",
    description: "",
    price: "",
    imageUrl: "",
    sortOrder: "0",
    isActive: true,
    isSoldOut: false,
    variants: [],
    addonGroupIds: [],
  };
}

function itemToForm(item) {
  return {
    id: item.id,
    categoryId: String(item.categoryId),
    name: item.name,
    description: item.description ?? "",
    price: String(item.price),
    imageUrl: item.imageUrl ?? "",
    sortOrder: String(item.sortOrder),
    isActive: item.isActive,
    isSoldOut: item.isSoldOut,
    variants: item.variants.map((v) => ({
      name: v.name,
      priceDelta: String(v.priceDelta),
      sortOrder: String(v.sortOrder),
    })),
    addonGroupIds: item.addonGroups.map((link) => link.group.id),
  };
}

function emptyGroupForm() {
  return { id: null, name: "", required: false, maxSelect: "1", addons: [] };
}

function groupToForm(group) {
  return {
    id: group.id,
    name: group.name,
    required: group.required,
    maxSelect: String(group.maxSelect),
    addons: group.addons.map((a) => ({ name: a.name, price: String(a.price) })),
  };
}

export default function MenuAdminClient({
  initialCategories,
  initialGroups,
  initialItems,
  initialItemsTotal,
  initialItemsTotalPages,
  pageSize,
  currency,
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [groups, setGroups] = useState(initialGroups);
  const [items, setItems] = useState(initialItems);
  const [itemsPage, setItemsPage] = useState(1);
  const [itemsTotal, setItemsTotal] = useState(initialItemsTotal);
  const [itemsTotalPages, setItemsTotalPages] = useState(initialItemsTotalPages);
  const [itemQuery, setItemQuery] = useState("");
  const [itemCategoryFilter, setItemCategoryFilter] = useState("all");
  const [loadingItems, setLoadingItems] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategorySort, setNewCategorySort] = useState("0");
  const [editingCategory, setEditingCategory] = useState(null);

  const [groupForm, setGroupForm] = useState(null);
  const [itemForm, setItemForm] = useState(null);

  const filtersInitialized = useRef(false);

  async function loadItems(page, q, categoryId) {
    setLoadingItems(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q.trim()) params.set("q", q.trim());
      if (categoryId !== "all") params.set("categoryId", String(categoryId));
      const data = await api(`/api/menu/items?${params.toString()}`);
      setItems(data.items);
      setItemsPage(data.page);
      setItemsTotal(data.total);
      setItemsTotalPages(data.totalPages);
    } catch (err) {
      setError(err?.message || "Could not load menu items.");
    } finally {
      setLoadingItems(false);
    }
  }

  // Debounced server-side search/filter (skips the first render: the
  // server already supplied page 1).
  useEffect(() => {
    if (!filtersInitialized.current) {
      filtersInitialized.current = true;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadItems(1, itemQuery, itemCategoryFilter);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemQuery, itemCategoryFilter]);

  async function loadCategories() {
    const data = await api("/api/menu/categories");
    setCategories(data.categories);
  }

  async function loadGroups() {
    const data = await api("/api/menu/addon-groups");
    setGroups(data.groups);
  }

  function flashNotice(message) {
    setNotice(message);
    setError("");
  }

  function flashError(err) {
    setError(err?.message || "Something went wrong. Please try again.");
    setNotice("");
  }

  // --- Categories ---------------------------------------------------------

  async function createCategory(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api("/api/menu/categories", {
        method: "POST",
        body: JSON.stringify({
          name: newCategoryName.trim(),
          sortOrder: parseIntField(newCategorySort, "Sort order"),
        }),
      });
      setNewCategoryName("");
      setNewCategorySort("0");
      await loadCategories();
      flashNotice("Category created.");
    } catch (err) {
      flashError(err);
    } finally {
      setSaving(false);
    }
  }

  async function saveCategory() {
    if (!editingCategory) return;
    setSaving(true);
    try {
      await api(`/api/menu/categories/${editingCategory.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editingCategory.name.trim(),
          sortOrder: parseIntField(editingCategory.sortOrder, "Sort order"),
          isActive: editingCategory.isActive,
        }),
      });
      setEditingCategory(null);
      await loadCategories();
      flashNotice("Category saved.");
    } catch (err) {
      flashError(err);
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(category) {
    if (
      !window.confirm(
        `Delete the category "${category.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyId(`category-${category.id}`);
    try {
      await api(`/api/menu/categories/${category.id}`, { method: "DELETE" });
      await loadCategories();
      flashNotice("Category deleted.");
    } catch (err) {
      flashError(err);
    } finally {
      setBusyId(null);
    }
  }

  // --- Addon groups -------------------------------------------------------

  async function saveGroup(event) {
    event.preventDefault();
    if (!groupForm) return;
    setSaving(true);
    try {
      const addons = groupForm.addons
        .filter((row) => row.name.trim() !== "")
        .map((row) => ({
          name: row.name.trim(),
          price: parseIntField(row.price, `Addon "${row.name.trim()}" price`),
        }));
      for (const addon of addons) {
        if (addon.price < 0) throw new Error("Addon prices cannot be negative.");
      }
      const maxSelect = parseIntField(groupForm.maxSelect, "Max select");
      if (maxSelect < 1) throw new Error("Max select must be 1 or more.");
      const payload = {
        name: groupForm.name.trim(),
        required: groupForm.required,
        maxSelect,
        addons,
      };
      if (groupForm.id) {
        await api(`/api/menu/addon-groups/${groupForm.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        flashNotice("Addon group saved.");
      } else {
        await api("/api/menu/addon-groups", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        flashNotice("Addon group created.");
      }
      setGroupForm(null);
      await loadGroups();
    } catch (err) {
      flashError(err);
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup(group) {
    if (
      !window.confirm(
        `Delete the addon group "${group.name}"? Items using it will lose the link. Past orders are unaffected.`,
      )
    ) {
      return;
    }
    setBusyId(`group-${group.id}`);
    try {
      await api(`/api/menu/addon-groups/${group.id}`, { method: "DELETE" });
      await loadGroups();
      await loadItems(itemsPage, itemQuery, itemCategoryFilter);
      flashNotice("Addon group deleted.");
    } catch (err) {
      flashError(err);
    } finally {
      setBusyId(null);
    }
  }

  // --- Items --------------------------------------------------------------

  async function saveItem(event) {
    event.preventDefault();
    if (!itemForm) return;
    setSaving(true);
    try {
      if (!itemForm.categoryId) throw new Error("Choose a category.");
      const price = parseIntField(itemForm.price, "Price");
      if (price < 0) throw new Error("Price cannot be negative.");
      const variants = itemForm.variants
        .filter((row) => row.name.trim() !== "")
        .map((row, index) => ({
          name: row.name.trim(),
          priceDelta: parseIntField(
            row.priceDelta,
            `Variant "${row.name.trim()}" price change`,
          ),
          sortOrder: parseIntField(row.sortOrder, "Variant sort order"),
        }));
      const payload = {
        categoryId: Number(itemForm.categoryId),
        name: itemForm.name.trim(),
        description: itemForm.description.trim(),
        price,
        imageUrl: itemForm.imageUrl.trim(),
        sortOrder: parseIntField(itemForm.sortOrder, "Sort order"),
        isActive: itemForm.isActive,
        isSoldOut: itemForm.isSoldOut,
        variants,
        addonGroupIds: itemForm.addonGroupIds,
      };
      if (itemForm.id) {
        await api(`/api/menu/items/${itemForm.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        flashNotice("Item saved.");
      } else {
        await api("/api/menu/items", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        flashNotice("Item created.");
      }
      setItemForm(null);
      await loadItems(1, itemQuery, itemCategoryFilter);
      await loadCategories();
    } catch (err) {
      flashError(err);
    } finally {
      setSaving(false);
    }
  }

  async function toggleItem(item, field) {
    setBusyId(`item-${item.id}-${field}`);
    try {
      const data = await api(`/api/menu/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: !item[field] }),
      });
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? data.item : row)),
      );
      flashNotice("Item updated.");
    } catch (err) {
      flashError(err);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteItem(item) {
    if (
      !window.confirm(
        `Delete "${item.name}"? This cannot be undone. Items with order history cannot be deleted.`,
      )
    ) {
      return;
    }
    setBusyId(`item-${item.id}-delete`);
    try {
      await api(`/api/menu/items/${item.id}`, { method: "DELETE" });
      await loadItems(itemsPage, itemQuery, itemCategoryFilter);
      await loadCategories();
      flashNotice("Item deleted.");
    } catch (err) {
      flashError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-4 space-y-6">
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {/* Categories */}
      <section className="card card-pad">
        <h2 className="section-title">Categories</h2>
        <p className="section-desc">
          Categories group items on the customer menu. Inactive categories
          are hidden from customers.
        </p>

        {categories.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No categories yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {categories.map((category) => (
              <li
                key={category.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
              >
                {editingCategory?.id === category.id ? (
                  <>
                    <input
                      type="text"
                      value={editingCategory.name}
                      maxLength={100}
                      onChange={(event) =>
                        setEditingCategory({
                          ...editingCategory,
                          name: event.target.value,
                        })
                      }
                      className="input min-w-40 flex-1"
                      aria-label="Category name"
                    />
                    <input
                      type="number"
                      value={editingCategory.sortOrder}
                      min={0}
                      step={1}
                      onChange={(event) =>
                        setEditingCategory({
                          ...editingCategory,
                          sortOrder: event.target.value,
                        })
                      }
                      className="input w-20"
                      aria-label="Sort order"
                    />
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={editingCategory.isActive}
                        onChange={(event) =>
                          setEditingCategory({
                            ...editingCategory,
                            isActive: event.target.checked,
                          })
                        }
                        className="h-4 w-4 accent-orange-600"
                      />
                      Active
                    </label>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={saveCategory}
                      className="btn btn-primary btn-sm"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCategory(null)}
                      className="btn btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 font-medium text-slate-900">
                      {category.name}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {category._count.items} item
                        {category._count.items === 1 ? "" : "s"} · order{" "}
                        {category.sortOrder}
                      </span>
                    </span>
                    {!category.isActive ? (
                      <Badge tone="slate">Inactive</Badge>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        setEditingCategory({
                          id: category.id,
                          name: category.name,
                          sortOrder: String(category.sortOrder),
                          isActive: category.isActive,
                        })
                      }
                      className="btn btn-secondary btn-sm"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busyId === `category-${category.id}`}
                      onClick={() => deleteCategory(category)}
                      className="btn btn-danger-outline btn-sm"
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={createCategory}
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
        >
          <div className="min-w-40 flex-1">
            <label htmlFor="new-category-name" className="label">
              New category
            </label>
            <input
              id="new-category-name"
              type="text"
              value={newCategoryName}
              maxLength={100}
              onChange={(event) => setNewCategoryName(event.target.value)}
              className="input"
              placeholder="e.g. Starters"
              required
            />
          </div>
          <div>
            <label htmlFor="new-category-sort" className="label">
              Sort order
            </label>
            <input
              id="new-category-sort"
              type="number"
              value={newCategorySort}
              min={0}
              step={1}
              onChange={(event) => setNewCategorySort(event.target.value)}
              className="input w-24"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
          >
            <Icon name="plus" className="h-4 w-4" />
            Add category
          </button>
        </form>
      </section>

      {/* Addon groups */}
      <section className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="section-title">Addon groups</h2>
            <p className="section-desc">
              Extras customers pick per item, e.g. extra cheese or spice
              level. Link a group to items in the item form below.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setGroupForm(emptyGroupForm())}
            className="btn btn-primary btn-sm"
          >
            <Icon name="plus" className="h-4 w-4" />
            New group
          </button>
        </div>

        {groupForm ? (
          <form
            onSubmit={saveGroup}
            className="mt-4 space-y-3 rounded-lg border border-slate-200 p-3"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label htmlFor="group-name" className="label">
                  Group name *
                </label>
                <input
                  id="group-name"
                  type="text"
                  value={groupForm.name}
                  maxLength={100}
                  onChange={(event) =>
                    setGroupForm({ ...groupForm, name: event.target.value })
                  }
                  className="input"
                  placeholder="e.g. Extra Cheese"
                  required
                />
              </div>
              <div>
                <label htmlFor="group-max" className="label">
                  Max select *
                </label>
                <input
                  id="group-max"
                  type="number"
                  value={groupForm.maxSelect}
                  min={1}
                  step={1}
                  onChange={(event) =>
                    setGroupForm({ ...groupForm, maxSelect: event.target.value })
                  }
                  className="input"
                  required
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={groupForm.required}
                onChange={(event) =>
                  setGroupForm({ ...groupForm, required: event.target.checked })
                }
                className="h-4 w-4 accent-orange-600"
              />
              Required — customers must pick from this group
            </label>

            <div>
              <p className="label">Addons</p>
              <div className="space-y-2">
                {groupForm.addons.map((row, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={row.name}
                      maxLength={100}
                      onChange={(event) => {
                        const addons = [...groupForm.addons];
                        addons[index] = { ...row, name: event.target.value };
                        setGroupForm({ ...groupForm, addons });
                      }}
                      className="input flex-1"
                      placeholder="Addon name"
                      aria-label={`Addon ${index + 1} name`}
                    />
                    <input
                      type="number"
                      value={row.price}
                      min={0}
                      step={1}
                      onChange={(event) => {
                        const addons = [...groupForm.addons];
                        addons[index] = { ...row, price: event.target.value };
                        setGroupForm({ ...groupForm, addons });
                      }}
                      className="input w-28"
                      placeholder="Price"
                      aria-label={`Addon ${index + 1} price`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setGroupForm({
                          ...groupForm,
                          addons: groupForm.addons.filter((_, i) => i !== index),
                        })
                      }
                      className="btn btn-secondary btn-sm"
                      aria-label={`Remove addon ${index + 1}`}
                    >
                      <Icon name="x" className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setGroupForm({
                    ...groupForm,
                    addons: [...groupForm.addons, { name: "", price: "0" }],
                  })
                }
                className="btn btn-secondary btn-sm mt-2"
              >
                <Icon name="plus" className="h-4 w-4" />
                Add addon
              </button>
              <p className="form-note mt-1">
                Prices are whole {currency}. Empty rows are ignored.
              </p>
            </div>

            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary">
                {saving ? "Saving…" : groupForm.id ? "Save group" : "Create group"}
              </button>
              <button
                type="button"
                onClick={() => setGroupForm(null)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {groups.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No addon groups yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {groups.map((group) => (
              <li
                key={group.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-slate-900">{group.name}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {group.required ? "Required · " : ""}
                    up to {group.maxSelect} · {group.addons.length} addon
                    {group.addons.length === 1 ? "" : "s"} ·{" "}
                    {group._count.menuItems} item
                    {group._count.menuItems === 1 ? "" : "s"}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {group.addons
                      .map(
                        (a) =>
                          `${a.name} (${a.price > 0 ? formatPKR(a.price, currency) : "free"})`,
                      )
                      .join(", ")}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setGroupForm(groupToForm(group))}
                  className="btn btn-secondary btn-sm"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busyId === `group-${group.id}`}
                  onClick={() => deleteGroup(group)}
                  className="btn btn-danger-outline btn-sm"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Items */}
      <section className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="section-title">Menu items</h2>
            <p className="section-desc">
              {itemsTotal} item{itemsTotal === 1 ? "" : "s"} in total.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setItemForm(emptyItemForm(categories[0]?.id))}
            className="btn btn-primary btn-sm"
          >
            <Icon name="plus" className="h-4 w-4" />
            New item
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="search"
            value={itemQuery}
            onChange={(event) => setItemQuery(event.target.value)}
            className="input min-w-48 flex-1"
            placeholder="Search items…"
            aria-label="Search items"
          />
          <select
            value={itemCategoryFilter}
            onChange={(event) => setItemCategoryFilter(event.target.value)}
            className="input w-auto"
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        {itemForm ? (
          <form
            onSubmit={saveItem}
            className="mt-4 space-y-3 rounded-lg border border-slate-200 p-3"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="item-category" className="label">
                  Category *
                </label>
                <select
                  id="item-category"
                  value={itemForm.categoryId}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, categoryId: event.target.value })
                  }
                  className="input"
                  required
                >
                  <option value="">Choose a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={String(category.id)}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="item-name" className="label">
                  Name *
                </label>
                <input
                  id="item-name"
                  type="text"
                  value={itemForm.name}
                  maxLength={150}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, name: event.target.value })
                  }
                  className="input"
                  placeholder="e.g. Chicken Tikka"
                  required
                />
              </div>
              <div>
                <label htmlFor="item-price" className="label">
                  Price ({currency}) *
                </label>
                <input
                  id="item-price"
                  type="number"
                  value={itemForm.price}
                  min={0}
                  step={1}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, price: event.target.value })
                  }
                  className="input"
                  placeholder="0"
                  required
                />
              </div>
              <div>
                <label htmlFor="item-sort" className="label">
                  Sort order
                </label>
                <input
                  id="item-sort"
                  type="number"
                  value={itemForm.sortOrder}
                  min={0}
                  step={1}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, sortOrder: event.target.value })
                  }
                  className="input"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="item-description" className="label">
                  Description
                </label>
                <input
                  id="item-description"
                  type="text"
                  value={itemForm.description}
                  maxLength={500}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, description: event.target.value })
                  }
                  className="input"
                  placeholder="Short description shown to customers"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="item-image" className="label">
                  Image URL (optional — link only, no upload)
                </label>
                <input
                  id="item-image"
                  type="url"
                  value={itemForm.imageUrl}
                  maxLength={500}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, imageUrl: event.target.value })
                  }
                  className="input"
                  placeholder="https://…"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={itemForm.isActive}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, isActive: event.target.checked })
                  }
                  className="h-4 w-4 accent-orange-600"
                />
                Active (shown on the menu)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={itemForm.isSoldOut}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, isSoldOut: event.target.checked })
                  }
                  className="h-4 w-4 accent-orange-600"
                />
                Sold out
              </label>
            </div>

            <div>
              <p className="label">Variants (sizes / portions)</p>
              <div className="space-y-2">
                {itemForm.variants.map((row, index) => (
                  <div key={index} className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={row.name}
                      maxLength={60}
                      onChange={(event) => {
                        const variants = [...itemForm.variants];
                        variants[index] = { ...row, name: event.target.value };
                        setItemForm({ ...itemForm, variants });
                      }}
                      className="input min-w-32 flex-1"
                      placeholder="e.g. Large"
                      aria-label={`Variant ${index + 1} name`}
                    />
                    <input
                      type="number"
                      value={row.priceDelta}
                      step={1}
                      onChange={(event) => {
                        const variants = [...itemForm.variants];
                        variants[index] = {
                          ...row,
                          priceDelta: event.target.value,
                        };
                        setItemForm({ ...itemForm, variants });
                      }}
                      className="input w-32"
                      placeholder="Price change"
                      aria-label={`Variant ${index + 1} price change`}
                    />
                    <input
                      type="number"
                      value={row.sortOrder}
                      min={0}
                      step={1}
                      onChange={(event) => {
                        const variants = [...itemForm.variants];
                        variants[index] = {
                          ...row,
                          sortOrder: event.target.value,
                        };
                        setItemForm({ ...itemForm, variants });
                      }}
                      className="input w-20"
                      aria-label={`Variant ${index + 1} sort order`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setItemForm({
                          ...itemForm,
                          variants: itemForm.variants.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                      className="btn btn-secondary btn-sm"
                      aria-label={`Remove variant ${index + 1}`}
                    >
                      <Icon name="x" className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setItemForm({
                    ...itemForm,
                    variants: [
                      ...itemForm.variants,
                      {
                        name: "",
                        priceDelta: "0",
                        sortOrder: String(itemForm.variants.length),
                      },
                    ],
                  })
                }
                className="btn btn-secondary btn-sm mt-2"
              >
                <Icon name="plus" className="h-4 w-4" />
                Add variant
              </button>
              <p className="form-note mt-1">
                Price change is added to the base price (0 = same price).
                Empty rows are ignored.
              </p>
            </div>

            {groups.length > 0 ? (
              <fieldset>
                <legend className="label">Addon groups for this item</legend>
                <div className="flex flex-wrap gap-2">
                  {groups.map((group) => (
                    <label
                      key={group.id}
                      className={`pill cursor-pointer ${itemForm.addonGroupIds.includes(group.id) ? "pill-active" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={itemForm.addonGroupIds.includes(group.id)}
                        onChange={(event) => {
                          const ids = event.target.checked
                            ? [...itemForm.addonGroupIds, group.id]
                            : itemForm.addonGroupIds.filter(
                                (id) => id !== group.id,
                              );
                          setItemForm({ ...itemForm, addonGroupIds: ids });
                        }}
                        className="sr-only"
                      />
                      {group.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary">
                {saving ? "Saving…" : itemForm.id ? "Save item" : "Create item"}
              </button>
              <button
                type="button"
                onClick={() => setItemForm(null)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {loadingItems ? (
          <p className="mt-4 text-sm text-slate-600">Loading items…</p>
        ) : items.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon="clipboard"
              title="No menu items found"
              description={
                itemQuery || itemCategoryFilter !== "all"
                  ? "Try a different search or category."
                  : "Create your first item with the New item button."
              }
            />
          </div>
        ) : (
          <div className="table-wrap mt-4">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="font-medium text-slate-900">
                        {item.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {item.variants.length} variant
                        {item.variants.length === 1 ? "" : "s"} ·{" "}
                        {item.addonGroups.length} addon group
                        {item.addonGroups.length === 1 ? "" : "s"} ·{" "}
                        {item._count.orderItems} order record
                        {item._count.orderItems === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td>{item.category?.name ?? "—"}</td>
                    <td>{formatPKR(item.price, currency)}</td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        {!item.isActive ? (
                          <Badge tone="slate">Inactive</Badge>
                        ) : null}
                        {item.isSoldOut ? (
                          <Badge tone="red">Sold out</Badge>
                        ) : null}
                        {item.isActive && !item.isSoldOut ? (
                          <Badge tone="green">Available</Badge>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <span className="flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          disabled={busyId === `item-${item.id}-isActive`}
                          onClick={() => toggleItem(item, "isActive")}
                          className="btn btn-secondary btn-sm"
                        >
                          {item.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === `item-${item.id}-isSoldOut`}
                          onClick={() => toggleItem(item, "isSoldOut")}
                          className="btn btn-secondary btn-sm"
                        >
                          {item.isSoldOut ? "Back in stock" : "Sold out"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setItemForm(itemToForm(item))}
                          className="btn btn-secondary btn-sm"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busyId === `item-${item.id}-delete`}
                          onClick={() => deleteItem(item)}
                          className="btn btn-danger-outline btn-sm"
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {itemsTotalPages > 1 ? (
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              Page {itemsPage} of {itemsTotalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={itemsPage <= 1 || loadingItems}
                onClick={() =>
                  loadItems(itemsPage - 1, itemQuery, itemCategoryFilter)
                }
                className="btn btn-secondary btn-sm"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={itemsPage >= itemsTotalPages || loadingItems}
                onClick={() =>
                  loadItems(itemsPage + 1, itemQuery, itemCategoryFilter)
                }
                className="btn btn-secondary btn-sm"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
