const fetch = require("node-fetch");

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GOLD_API_KEY = process.env.GOLD_API_KEY;

// ─── 1. FETCH LIVE GOLD RATE (INR per gram 24KT) ───────────────────────────
async function getGoldRateINR() {

  const res = await fetch(
    "https://www.goldapi.io/api/XAU/INR",
    {
      headers: {
        "x-access-token": GOLD_API_KEY,
        "Content-Type": "application/json"
      }
    }
  );

  if (!res.ok) {

    const text = await res.text();

    throw new Error(
      `GoldAPI Error ${res.status}: ${text}`
    );
  }

  const data = await res.json();

  if (!data.price_gram_24k) {

    throw new Error(
      "GoldAPI did not return price_gram_24k"
    );
  }

  const inrPerGram24k =
    data.price_gram_24k;

  console.log(
    `Gold rate: ₹${inrPerGram24k.toFixed(2)}/gram (24KT)`
  );

  return inrPerGram24k;
}

// ─── 2. FETCH PRODUCTS ─────────────────────────────────────────────────────
async function getProducts() {

  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/products.json?limit=250`,
    {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      }
    }
  );

  const data = await res.json();

  if (!data.products) {

    console.log(
      "Shopify response:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "Could not fetch products"
    );
  }

  return data.products;
}

// ─── 3. FETCH PRODUCT METAFIELDS ───────────────────────────────────────────
async function getMetafields(productId) {

  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/products/${productId}/metafields.json`,
    {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      }
    }
  );

  const data = await res.json();

  return data.metafields || [];
}

// ─── HELPER: GET METAFIELD VALUE ───────────────────────────────────────────
function getMeta(metafields, key) {

  const found = metafields.find(
    (m) =>
      m.key.toLowerCase() ===
      key.toLowerCase()
  );

  return found ? found.value : null;
}

// ─── HELPER: DETECT PURITY FROM VARIANT ────────────────────────────────────
function getPurityFromVariant(variant) {

  const text = (
    `
    ${variant.title}
    ${variant.option1 || ""}
    ${variant.option2 || ""}
    ${variant.option3 || ""}
    `
  ).toLowerCase();

  if (
    text.includes("18kt") ||
    text.includes("18k")
  ) {
    return 18;
  }

  if (
    text.includes("14kt") ||
    text.includes("14k")
  ) {
    return 14;
  }

  if (
    text.includes("9kt") ||
    text.includes("9k")
  ) {
    return 9;
  }

  // fallback
  return 22;
}

// ─── 4. CALCULATE FINAL PRICE ──────────────────────────────────────────────
function calculatePrice(
  goldRateINR24k,
  metafields,
  purity
) {

  // METAFIELDS
  const weight =
    parseFloat(
      getMeta(metafields, "weight")
    ) || 0;

  const stoneCost =
    parseFloat(
      getMeta(metafields, "stone_cost")
    ) || 0;

  const makingChargesPercent =
    parseFloat(
      getMeta(metafields, "making_charges")
    ) || 0;

  const gstPercent =
    parseFloat(
      getMeta(metafields, "gst")
    ) || 3;

  // STEP 1:
  // Convert 24KT live rate to purity rate
  const purityRate =
    goldRateINR24k *
    (purity / 24);

  // STEP 2:
  // Gold value
  const goldValue =
    purityRate * weight;

  // STEP 3:
  // Add stone cost
  const subtotal =
    goldValue + stoneCost;

  // STEP 4:
  // Add making charges (%)
  const withMakingCharges =
    subtotal *
    (1 + makingChargesPercent / 100);

  // STEP 5:
  // Add GST (%)
  const finalPrice =
    withMakingCharges *
    (1 + gstPercent / 100);

  return Math.round(finalPrice);
}

// ─── 5. UPDATE VARIANT PRICE ───────────────────────────────────────────────
async function updateVariantPrice(
  variantId,
  price
) {

  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/variants/${variantId}.json`,
    {
      method: "PUT",

      headers: {
        "Content-Type":
          "application/json",

        "X-Shopify-Access-Token":
          TOKEN
      },

      body: JSON.stringify({
        variant: {
          id: variantId,
          price: price.toString()
        }
      })
    }
  );

  const data = await res.json();

  if (!data.variant) {

    console.error(
      `✗ Shopify error updating variant ${variantId}:`,
      JSON.stringify(data, null, 2)
    );
  }
}

// ─── 6. MAIN ────────────────────────────────────────────────────────────────
async function run() {

  try {

    console.log("Store:", SHOP);

    const goldRateINR =
      await getGoldRateINR();

    const products =
      await getProducts();

    console.log(
      `\nUpdating ${products.length} product(s)...\n`
    );

    for (const product of products) {

      try {

        const metafields =
          await getMetafields(
            product.id
          );

        // LOOP THROUGH ALL VARIANTS
        for (const variant of product.variants) {

          // Detect purity from variant
          const purity =
            getPurityFromVariant(
              variant
            );

          // Calculate price
          const finalPrice =
            calculatePrice(
              goldRateINR,
              metafields,
              purity
            );

          // Update Shopify variant price
          await updateVariantPrice(
            variant.id,
            finalPrice
          );

          console.log(
            `✓ ${product.title} | ${variant.title} → ₹${finalPrice}`
          );
        }

      } catch (err) {

        console.error(
          `✗ ${product.title}:`,
          err.message
        );
      }
    }

    console.log("\nAll done.");

  } catch (err) {

    console.error(
      "Fatal error:",
      err.message
    );

    process.exit(1);
  }
}

run();
