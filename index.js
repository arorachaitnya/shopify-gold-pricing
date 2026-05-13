const fetch = require("node-fetch");

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GOLD_API_KEY = process.env.GOLD_API_KEY;

// ─────────────────────────────────────────────────────────────
// 1. FETCH LIVE GOLD RATE (24KT INR/GRAM)
// ─────────────────────────────────────────────────────────────
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

  const goldRate24k =
    data.price_gram_24k;

  console.log(
    `\nLive Gold Rate (24KT): ₹${goldRate24k.toFixed(2)}/gram\n`
  );

  return goldRate24k;
}

// ─────────────────────────────────────────────────────────────
// 2. FETCH PRODUCTS
// ─────────────────────────────────────────────────────────────
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
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "Could not fetch products"
    );
  }

  return data.products;
}

// ─────────────────────────────────────────────────────────────
// 3. FETCH PRODUCT METAFIELDS
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// 4. GET METAFIELD VALUE
// ─────────────────────────────────────────────────────────────
function getMeta(metafields, key) {

  const found = metafields.find(
    (m) =>
      m.key.toLowerCase() ===
      key.toLowerCase()
  );

  return found ? found.value : null;
}

// ─────────────────────────────────────────────────────────────
// 5. DETECT GOLD PURITY FROM VARIANT
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// 6. CALCULATE FINAL PRICE
// ─────────────────────────────────────────────────────────────
function calculatePrice(
  goldRate24k,
  metafields,
  purity
) {

  // PRODUCT METAFIELDS

  const weight =
    parseFloat(
      getMeta(metafields, "weight")
    ) || 0;

  const stoneCost =
    parseFloat(
      getMeta(metafields, "stone_cost")
    ) || 0;

  const makingCharges =
    parseFloat(
      getMeta(metafields, "making_value")
    ) || 0;

  const gst =
    parseFloat(
      getMeta(metafields, "gst")
    ) || 3;

  // CONVERT 24KT RATE TO VARIANT PURITY RATE

  const purityRate =
    goldRate24k *
    (purity / 24);

  // GOLD VALUE

  const goldValue =
    purityRate * weight;

  // ADD STONE COST

  const subtotal =
    goldValue + stoneCost;

  // APPLY MAKING CHARGES %

  const afterMakingCharges =
    subtotal *
    (1 + makingCharges / 100);

  // APPLY GST %

  const finalPrice =
    afterMakingCharges *
    (1 + gst / 100);

  return Math.round(finalPrice);
}

// ─────────────────────────────────────────────────────────────
// 7. UPDATE VARIANT PRICE
// ─────────────────────────────────────────────────────────────
async function updateVariantPrice(
  variantId,
  price
) {

  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/variants/${variantId}.json`,
    {
      method: "PUT",

      headers: {
        "X-Shopify-Access-Token":
          TOKEN,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        variant: {
          id: variantId,
          price: String(price)
        }
      })
    }
  );

  const text =
    await res.text();

  console.log(
    `\nVariant ${variantId} Response:\n`,
    text
  );

  let data = {};

  try {

    data =
      JSON.parse(text);

  } catch (e) {}

  if (!data.variant) {

    throw new Error(
      `Failed to update variant ${variantId}`
    );
  }

  console.log(
    `✓ Updated Variant ${variantId} → ₹${price}`
  );
}

// ─────────────────────────────────────────────────────────────
// 8. MAIN
// ─────────────────────────────────────────────────────────────
async function run() {

  try {

    console.log(
      `Store: ${SHOP}\n`
    );

    const goldRate24k =
      await getGoldRateINR();

    const products =
      await getProducts();

    console.log(
      `Updating ${products.length} products...\n`
    );

    for (const product of products) {

      try {

        const metafields =
          await getMetafields(
            product.id
          );

        // LOOP THROUGH ALL VARIANTS

        for (const variant of product.variants) {

          // DETECT PURITY

          const purity =
            getPurityFromVariant(
              variant
            );

          // CALCULATE PRICE

          const finalPrice =
            calculatePrice(
              goldRate24k,
              metafields,
              purity
            );

          // DEBUG LOGS

          console.log({
            product:
              product.title,

            variant:
              variant.title,

            purity,

            weight:
              getMeta(
                metafields,
                "weight"
              ),

            stoneCost:
              getMeta(
                metafields,
                "stone_cost"
              ),

            makingCharges:
              getMeta(
                metafields,
                "making_value"
              ),

            gst:
              getMeta(
                metafields,
                "gst"
              ),

            finalPrice
          });

          // UPDATE SHOPIFY PRICE

          await updateVariantPrice(
            variant.id,
            finalPrice
          );
        }

      } catch (err) {

        console.error(
          `\n✗ ${product.title}`
        );

        console.error(
          err.message
        );
      }
    }

    console.log(
      "\n✓ ALL PRODUCTS UPDATED\n"
    );

  } catch (err) {

    console.error(
      "\nFATAL ERROR:"
    );

    console.error(
      err.message
    );

    process.exit(1);
  }
}

run();
