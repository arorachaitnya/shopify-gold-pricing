const fetch = require("node-fetch");

const SHOP  = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GOLD_API_KEY = process.env.GOLD_API_KEY;

// ─── 1. FETCH LIVE GOLD RATE (INR per gram) ───────────────────────────────────
async function getGoldRateINR() {
  // GoldAPI.io — free, reliable, works in GitHub Actions
  const res = await fetch("https://www.goldapi.io/api/XAU/INR", {
    headers: { "x-access-token": GOLD_API_KEY }
  });

  if (!res.ok) {
    throw new Error(`GoldAPI responded with status ${res.status}`);
  }

  const data = await res.json();
  const inrPerGram24k = data.price_gram_24k;

  console.log(`Gold rate: ₹${inrPerGram24k.toFixed(2)}/gram (24k)`);
  return inrPerGram24k;
}

// ─── 2. FETCH ALL PRODUCTS ────────────────────────────────────────────────────
async function getProducts() {
  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/products.json?limit=250`,
    { headers: { "X-Shopify-Access-Token": TOKEN } }
  );
  const data = await res.json();
  return data.products;
}

// ─── 3. FETCH METAFIELDS FOR A PRODUCT ───────────────────────────────────────
async function getMetafields(productId) {
  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/products/${productId}/metafields.json`,
    { headers: { "X-Shopify-Access-Token": TOKEN } }
  );
  const data = await res.json();
  return data.metafields || [];
}

// Helper: find a metafield value by key (case-insensitive)
function getMeta(metafields, key) {
  const found = metafields.find(
    (m) => m.key.toLowerCase() === key.toLowerCase()
  );
  return found ? found.value : null;
}

// ─── 4. CALCULATE FINAL PRICE ─────────────────────────────────────────────────
function calculatePrice(goldRateINR24k, metafields) {
  const weight      = parseFloat(getMeta(metafields, "weight"))        || 0;
  const purity      = parseFloat(getMeta(metafields, "purity"))        || 22;
  const makingValue = parseFloat(getMeta(metafields, "making_value"))  || 0;
  const makingType  = (getMeta(metafields, "making_type") || "percentage").toLowerCase().trim();
  const stoneCost   = parseFloat(getMeta(metafields, "stone_cost"))    || 0;
  const gst         = parseFloat(getMeta(metafields, "gst"))           || 3;

  // Gold value: rate is per gram at 24k, scale by purity
  const goldValue = goldRateINR24k * weight * (purity / 24);

  // Making charges: flat amount OR percentage of gold value
  const makingCharge = makingType === "flat"
    ? makingValue
    : goldValue * (makingValue / 100);

  // Subtotal (gold + making + stone)
  const subtotal = goldValue + makingCharge + stoneCost;

  // Apply GST
  const finalPrice = subtotal * (1 + gst / 100);

  return Math.round(finalPrice);
}

// ─── 5. UPDATE VARIANT PRICE ON SHOPIFY ──────────────────────────────────────
async function updateVariantPrice(variantId, price) {
  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/variants/${variantId}.json`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
      },
      body: JSON.stringify({
        variant: { id: variantId, price: price.toString() },
      }),
    }
  );
  const data = await res.json();
  if (!data.variant) {
    console.error(`  ✗ Shopify error on variant ${variantId}:`, JSON.stringify(data));
  }
}

// ─── 6. MAIN ──────────────────────────────────────────────────────────────────
async function run() {
  try {
    const goldRateINR = await getGoldRateINR();
    const products = await getProducts();
    console.log(`\nUpdating ${products.length} product(s)...\n`);

    for (const product of products) {
      try {
        const metafields  = await getMetafields(product.id);
        const finalPrice  = calculatePrice(goldRateINR, metafields);
        const variant     = product.variants[0];

        await updateVariantPrice(variant.id, finalPrice);
        console.log(`  ✓ ${product.title} → ₹${finalPrice}`);
      } catch (err) {
        console.error(`  ✗ "${product.title}": ${err.message}`);
      }
    }

    console.log("\nAll done.");
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exit(1);
  }
}

run();
