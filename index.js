const fetch = require("node-fetch");

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ─── 1. FETCH LIVE GOLD RATE (INR per gram) ───────────────────────────────────
async function getGoldRateINR() {
  // metals.live is reliable in GitHub Actions unlike api.gold-api.com
  const res = await fetch("https://metals.live/api/spot/gold");
  const data = await res.json();
  const usdPerOunce = data[0].price;
  const usdPerGram = usdPerOunce / 31.1035;

  // Live USD → INR rate
  const fxRes = await fetch("https://api.frankfurter.app/latest?from=USD&to=INR");
  const fxData = await fxRes.json();
  const usdToInr = fxData.rates.INR;

  const inrPerGram = usdPerGram * usdToInr;
  console.log(`Gold: $${usdPerOunce.toFixed(2)}/oz | ₹${inrPerGram.toFixed(2)}/g | 1 USD = ₹${usdToInr}`);
  return inrPerGram;
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

// Helper: find a metafield value by key name (case-insensitive)
function getMeta(metafields, key) {
  const found = metafields.find(
    (m) => m.key.toLowerCase() === key.toLowerCase()
  );
  return found ? found.value : null;
}

// ─── 4. CALCULATE FINAL PRICE ─────────────────────────────────────────────────
function calculatePrice(goldRateINR, metafields) {
  const weight      = parseFloat(getMeta(metafields, "weight"))       || 0;
  const purity      = parseFloat(getMeta(metafields, "purity"))       || 22;
  const makingValue = parseFloat(getMeta(metafields, "making_value")) || 0;
  const makingType  = (getMeta(metafields, "making_type") || "percentage").toLowerCase().trim();
  const stoneCost   = parseFloat(getMeta(metafields, "stone_cost"))   || 0;
  const gst         = parseFloat(getMeta(metafields, "gst"))          || 3;

  // Gold value based on weight and purity
  const goldValue = goldRateINR * weight * (purity / 24);

  // Making charges — either flat amount or % of gold value
  const makingCharge = makingType === "flat"
    ? makingValue
    : goldValue * (makingValue / 100);

  // Subtotal before GST (gold + making + stone)
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
    console.error(`  ✗ Failed to update variant ${variantId}:`, JSON.stringify(data));
  }
}

// ─── 6. MAIN ──────────────────────────────────────────────────────────────────
async function run() {
  try {
    const goldRateINR = await getGoldRateINR();
    const products = await getProducts();
    console.log(`\nUpdating ${products.length} products...\n`);

    for (const product of products) {
      try {
        const metafields = await getMetafields(product.id);
        const finalPrice = calculatePrice(goldRateINR, metafields);
        const variant = product.variants[0];

        await updateVariantPrice(variant.id, finalPrice);
        console.log(`  ✓ ${product.title} → ₹${finalPrice}`);
      } catch (err) {
        console.error(`  ✗ Error on "${product.title}": ${err.message}`);
        // Continue to next product even if one fails
      }
    }

    console.log("\nDone.");
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exit(1);
  }
}

run();
