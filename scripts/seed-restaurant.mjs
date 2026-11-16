// SAVE AS: scripts/seed-restaurant.mjs
// DEMO seed — idempotent upserts ONLY, safe to re-run.
// Creates: 1 Setting row, 4 categories, 12 demo menu items (with
// variants + addon groups), 6 tables. NO users, NO orders, NO payments
// (accounts are created via signup; the first becomes Admin).
// WARNING: the menu below is DEMO data. Replace it with the real menu
// in Admin > Menu before going live.
//
// Env loading: reads .env then .env.local from the project root. Real
// process.env values always win over file values. No dotenv dependency
// is used (it is not in the locked dependency set).

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const realEnvKeys = new Set(Object.keys(process.env));

function loadEnvFile(filename) {
  const path = join(rootDir, filename);
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (realEnvKeys.has(key)) continue; // Real env wins.
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const prisma = new PrismaClient();

// --- DEMO data -------------------------------------------------------------
// All prices are whole PKR. Replace with the real menu before going live.

const CATEGORIES = [
  { id: 1, name: "Starters", sortOrder: 0 },
  { id: 2, name: "Main Course", sortOrder: 1 },
  { id: 3, name: "BBQ & Grill", sortOrder: 2 },
  { id: 4, name: "Drinks & Desserts", sortOrder: 3 },
];

const ITEMS = [
  { id: 1, categoryId: 1, name: "Chicken Soup", description: "Hot and comforting chicken soup.", price: 250, sortOrder: 0 },
  { id: 2, categoryId: 1, name: "Spring Rolls", description: "Crispy vegetable spring rolls, 4 pieces.", price: 350, sortOrder: 1 },
  { id: 3, categoryId: 2, name: "Chicken Karahi", description: "Wok-tossed chicken karahi with green chillies.", price: 650, sortOrder: 0 },
  { id: 4, categoryId: 2, name: "Chicken Biryani", description: "Fragrant basmati biryani with raita.", price: 450, sortOrder: 1 },
  { id: 5, categoryId: 2, name: "Daal Fry", description: "Yellow daal tempered with garlic and cumin.", price: 350, sortOrder: 2 },
  { id: 6, categoryId: 3, name: "Chicken Tikka", description: "Charcoal-grilled chicken tikka leg piece.", price: 480, sortOrder: 0 },
  { id: 7, categoryId: 3, name: "Seekh Kabab", description: "Beef seekh kabab, 4 pieces, with onions.", price: 550, sortOrder: 1 },
  { id: 8, categoryId: 3, name: "Malai Boti", description: "Creamy grilled chicken malai boti.", price: 650, sortOrder: 2 },
  { id: 9, categoryId: 4, name: "Mint Margarita", description: "Fresh mint and lemon cooler.", price: 300, sortOrder: 0 },
  { id: 10, categoryId: 4, name: "Cold Drink", description: "Chilled soft drink, regular can.", price: 120, sortOrder: 1 },
  { id: 11, categoryId: 4, name: "Kulfi Falooda", description: "Kulfi falooda with basil seeds and syrup.", price: 350, sortOrder: 2 },
  { id: 12, categoryId: 4, name: "Gulab Jamun", description: "Warm gulab jamun, 2 pieces.", price: 200, sortOrder: 3 },
];

const VARIANTS = [
  { id: 1, menuItemId: 3, name: "Half", priceDelta: 0, sortOrder: 0 },
  { id: 2, menuItemId: 3, name: "Full", priceDelta: 550, sortOrder: 1 },
  { id: 3, menuItemId: 3, name: "Family", priceDelta: 1100, sortOrder: 2 },
  { id: 4, menuItemId: 4, name: "Single", priceDelta: 0, sortOrder: 0 },
  { id: 5, menuItemId: 4, name: "Double", priceDelta: 200, sortOrder: 1 },
];

const ADDON_GROUPS = [
  { id: 1, name: "Extras", required: false, maxSelect: 3 },
  { id: 2, name: "Spice Level", required: false, maxSelect: 1 },
];

const ADDONS = [
  { id: 1, groupId: 1, name: "Extra Cheese", price: 80 },
  { id: 2, groupId: 1, name: "Extra Raita", price: 50 },
  { id: 3, groupId: 1, name: "Extra Salad", price: 60 },
  { id: 4, groupId: 2, name: "Mild", price: 0 },
  { id: 5, groupId: 2, name: "Medium", price: 0 },
  { id: 6, groupId: 2, name: "Extra Hot", price: 0 },
];

// [menuItemId, groupId] pairs.
const ITEM_ADDON_LINKS = [
  [3, 1], // Chicken Karahi -> Extras
  [3, 2], // Chicken Karahi -> Spice Level
  [4, 1], // Chicken Biryani -> Extras
  [6, 1], // Chicken Tikka -> Extras
  [6, 2], // Chicken Tikka -> Spice Level
];

const TABLES = [
  { code: "T1", name: "Table 1", seats: 2 },
  { code: "T2", name: "Table 2", seats: 4 },
  { code: "T3", name: "Table 3", seats: 4 },
  { code: "T4", name: "Table 4", seats: 6 },
  { code: "T5", name: "Table 5", seats: 6 },
  { code: "T6", name: "Table 6", seats: 8 },
];

async function main() {
  await prisma.setting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      restaurantName: "My Restaurant",
      currency: "Rs",
      taxRate: 0,
      taxEnabled: false,
      serviceChargeRate: 0,
      serviceChargeEnabled: false,
      deliveryFee: 0,
      freeDeliveryThreshold: 0,
      minOrderAmount: 0,
      receiptFooter: "Thank you! Visit again.",
    },
  });
  console.log("Setting: upserted row id=1 (My Restaurant, demo defaults)");

  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { id: category.id },
      update: { name: category.name, sortOrder: category.sortOrder },
      create: { ...category },
    });
  }
  console.log(`Categories: upserted ${CATEGORIES.length} (Starters, Main Course, BBQ & Grill, Drinks & Desserts)`);

  for (const item of ITEMS) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        price: item.price,
        sortOrder: item.sortOrder,
      },
      create: { ...item },
    });
  }
  console.log(`Menu items: upserted ${ITEMS.length} demo items (whole PKR prices)`);

  for (const variant of VARIANTS) {
    await prisma.menuItemVariant.upsert({
      where: { id: variant.id },
      update: {
        menuItemId: variant.menuItemId,
        name: variant.name,
        priceDelta: variant.priceDelta,
        sortOrder: variant.sortOrder,
      },
      create: { ...variant },
    });
  }
  console.log(`Variants: upserted ${VARIANTS.length} (Karahi Half/Full/Family, Biryani Single/Double)`);

  for (const group of ADDON_GROUPS) {
    await prisma.addonGroup.upsert({
      where: { id: group.id },
      update: { name: group.name, required: group.required, maxSelect: group.maxSelect },
      create: { ...group },
    });
  }
  for (const addon of ADDONS) {
    await prisma.addon.upsert({
      where: { id: addon.id },
      update: { groupId: addon.groupId, name: addon.name, price: addon.price },
      create: { ...addon },
    });
  }
  console.log(`Addon groups: upserted ${ADDON_GROUPS.length} groups, ${ADDONS.length} addons (Extras, Spice Level)`);

  for (const [menuItemId, groupId] of ITEM_ADDON_LINKS) {
    await prisma.menuItemAddonGroup.upsert({
      where: { menuItemId_groupId: { menuItemId, groupId } },
      update: {},
      create: { menuItemId, groupId },
    });
  }
  console.log(`Menu addon links: upserted ${ITEM_ADDON_LINKS.length} item-group links`);

  for (const table of TABLES) {
    await prisma.table.upsert({
      where: { code: table.code },
      update: { name: table.name, seats: table.seats },
      create: { ...table },
    });
  }
  console.log(`Tables: upserted ${TABLES.length} (T1-T6, seats 2/4/4/6/6/8)`);

  // Categories/items/variants/groups/addons were upserted with explicit
  // ids, which does not advance the Postgres autoincrement sequences.
  // Reset each sequence to MAX(id) so later Admin-created rows (which
  // rely on the sequence) cannot collide with seeded ids. Table names
  // below are hardcoded constants, never user input.
  for (const table of ["Category", "MenuItem", "MenuItemVariant", "AddonGroup", "Addon"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX("id") FROM "${table}"), 1))`,
    );
  }
  console.log("Sequences: reset for Category, MenuItem, MenuItemVariant, AddonGroup, Addon");

  console.log("\nSeed complete. No users, orders, or payments were created.");
  console.log("WARNING: the menu above is DEMO data — replace it with the real menu in Admin > Menu before going live.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
