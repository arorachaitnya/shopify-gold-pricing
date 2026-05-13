const fetch = require("node-fetch");

const SHOP          = (process.env.SHOPIFY_STORE         || "").trim();
const TOKEN         = (process.env.SHOPIFY_ACCESS_TOKEN  || "").trim();
const GOLD_API_KEY  = (process.env.GOLD_API_KEY          || "").trim();

// ─── DEBUG (safe — won't expose full secrets) ─────────────────────────────────
console.log("=== STARTUP ===");
console.log("SHOP        :", SHOP);
console.log("TOKEN prefix:", TOKEN.slice(0, 10));
console.log("GOLD KEY pfx:", GOLD_API_KEY.slice(0, 10));
console.log("===============\n");

// ─── 1. GOLD RATE ─────────────────────────────────────────────────────────────
async function getGoldRateINR() {
  const res = await fetch("https://www.goldapi.io/api/XAU/INR", {
    headers: {
      "x-access-token": GOLD_API_KEY,
      "Content-Type": "application/json"
    }
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`GoldAPI HTTP ${res.status}: ${text}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`GoldAPI bad JSON: ${text.slice(0, 200)}`);
  }

  if (!data.price_gram_24k) {
    throw new Error(`GoldAPI missing price_gram_24k. Got: ${text.slice(0, 200)}`);
  }

  console.log(`Gold Rate (24k): ₹${data.price_gram_24k.toFixed(2)}/gram`);
  return data.price_gram_24k;
}

// ─── 2. FETCH PRODUCTS ────────────────────────────────────────────────────────
async function getProducts() {
  const url = `https://${SHOP}/admin/api/2025-01/products.json?limit=250`;
  console.log("Fetching products from:", url);

  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": TOKEN }
  });

  const text = await res.text();
  console.log("Shopify raw response:", text.slice(0, 300));

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Shopify bad JSON: ${text.slice(0, 200)}`);
  }

  if (!data.products) {
    throw new Error(`Shopify error: ${text.slice(0, 300)}`);
  }

  console.log(`Found ${data.products.length} products\n`);
  return data.products;
}

// ─── 3. FETCH METAFIELDS ──────────────────────────────────────────────────────
async function getMetafields(productId) {
  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/products/${productId}/metafields.json`,
    { headers: { "X-Shopify-Access-Token": TOKEN } }
  );
  const data = await res.json();
  return data.metafields || [];
}

// ─── 4. HELPER ────────────────────────────────────────────────────────────────
function getMeta(metafields, key) {
  const found = metafields.find(
    (m) => m.key.toLowerCase() === key.toLowerCase()
  );
  return found ? found.value : null;
}

// ─── 5. DETECT PURITY FROM VARIANT TITLE ─────────────────────────────────────
function getPurity(variant) {
  const text = [
    variant.title,
    variant.option1,
    variant.option2,
    variant.option3
  ].join(" ").toLowerCase();

  if (text.includes("18kt") || text.includes("18k")) return 18;
  if (text.includes("14kt") || text.includes("14k")) return 14;
  if (text.includes("9kt")  || text.includes("9k"))  return 9;
  return 22; // default
}

// ─── 6. CALCULATE PRICE ───────────────────────────────────────────────────────
function calculatePrice(goldRate24k, metafields, purity) {
  const weight       = parseFloat(getMeta(metafields, "weight"))       || 0;
  const stoneCost    = parseFloat(getMeta(metafields, "stone_cost"))   || 0;
  const makingValue  = parseFloat(getMeta(metafields, "making_value")) || 0;
  const makingType   = (getMeta(metafields, "making_type") || "percentage").toLowerCase().trim();
  const gst          = parseFloat(getMeta(metafields, "gst"))          || 3;

  const purityRate   = goldRate24k * (purity / 24);
  const goldValue    = purityRate * weight;
  const makingCharge = makingType === "flat"
    ? makingValue
    : goldValue * (makingValue / 100);

  const subtotal     = goldValue + makingCharge + stoneCost;
  const finalPrice   = subtotal * (1 + gst / 100);

  return Math.round(finalPrice);
}

// ─── 7. UPDATE VARIANT PRICE ──────────────────────────────────────────────────
async function updateVariantPrice(variantId, price) {
  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/variants/${variantId}.json`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      body: JSON.stringify({
        variant: { id: variantId, price: price.toString() }
      })
    }
  );
  const data = await res.json();
  if (!data.variant) {
    console.error(`  ✗ Failed to update variant ${variantId}:`, JSON.stringify(data));
  }
}

// ─── 8. MAIN ──────────────────────────────────────────────────────────────────
async function run() {
  try {
    const goldRate24k = await getGoldRateINR();
    const products    = await getProducts();

    for (const product of products) {
      try {
        const metafields = await getMetafields(product.id);

        for (const variant of product.variants) {
          const purity     = getPurity(variant);
          const finalPrice = calculatePrice(goldRate24k, metafields, purity);

          console.log(`  → ${product.title} [${variant.title}] | ${purity}k | ₹${finalPrice}`);
          await updateVariantPrice(variant.id, finalPrice);
          console.log(`    ✓ Updated`);
        }
      } catch (err) {
        console.error(`  ✗ "${product.title}": ${err.message}`);
      }
    }

    console.log("\n✓ ALL DONE");
  } catch (err) {
    console.error("\nFATAL:", err.message);
    process.exit(1);
  }
}

run();
