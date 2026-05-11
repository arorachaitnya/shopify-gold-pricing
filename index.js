const fetch = require("node-fetch");

const SHOP =
  process.env.SHOPIFY_STORE;

const CLIENT_ID =
  process.env.SHOPIFY_CLIENT_ID;

const CLIENT_SECRET =
  process.env.SHOPIFY_CLIENT_SECRET;

const GOLD_API_KEY =
  process.env.GOLD_API_KEY;

// ─── 1. GENERATE SHOPIFY ACCESS TOKEN ─────────────────────────────
async function getShopifyToken() {

  const response =
    await fetch(
      `https://${SHOP}/admin/oauth/access_token`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          client_id:
            CLIENT_ID,

          client_secret:
            CLIENT_SECRET,

          grant_type:
            "client_credentials"
        })
      }
    );

  const data =
    await response.json();

  console.log(
    "Token response:",
    data
  );

  if (!data.access_token) {
    throw new Error(
      "Could not generate Shopify token"
    );
  }

  return data.access_token;
}

// ─── 2. FETCH LIVE GOLD RATE ──────────────────────────────────────
async function getGoldRateINR() {

  const res =
    await fetch(
      "https://www.goldapi.io/api/XAU/INR",
      {
        headers: {
          "x-access-token":
            GOLD_API_KEY
        }
      }
    );

  if (!res.ok) {
    throw new Error(
      `GoldAPI status ${res.status}`
    );
  }

  const data =
    await res.json();

  const rate =
    data.price_gram_24k;

  console.log(
    `Gold rate: ₹${rate}/gram`
  );

  return rate;
}

// ─── 3. FETCH PRODUCTS ────────────────────────────────────────────
async function getProducts(
  token
) {

  const res =
    await fetch(
      `https://${SHOP}/admin/api/2025-01/products.json?limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token":
            token
        }
      }
    );

  const data =
    await res.json();

  console.log(
    "Products fetched"
  );

  return data.products || [];
}

// ─── 4. FETCH PRODUCT METAFIELDS ─────────────────────────────────
async function getMetafields(
  token,
  productId
) {

  const res =
    await fetch(
      `https://${SHOP}/admin/api/2025-01/products/${productId}/metafields.json`,
      {
        headers: {
          "X-Shopify-Access-Token":
            token
        }
      }
    );

  const data =
    await res.json();

  return data.metafields || [];
}

// ─── 5. HELPER ────────────────────────────────────────────────────
function getMeta(
  metafields,
  key
) {

  const found =
    metafields.find(
      (m) =>
        m.key.toLowerCase() ===
        key.toLowerCase()
    );

  return found
    ? found.value
    : null;
}

// ─── 6. CALCULATE PRICE ───────────────────────────────────────────
function calculatePrice(
  goldRate,
  metafields
) {

  const weight =
    parseFloat(
      getMeta(
        metafields,
        "weight"
      )
    ) || 0;

  const purity =
    parseFloat(
      getMeta(
        metafields,
        "purity"
      )
    ) || 22;

  const makingValue =
    parseFloat(
      getMeta(
        metafields,
        "making_value"
      )
    ) || 0;

  const makingType =
    (
      getMeta(
        metafields,
        "making_type"
      ) || "percentage"
    )
      .toLowerCase()
      .trim();

  const stoneCost =
    parseFloat(
      getMeta(
        metafields,
        "stone_cost"
      )
    ) || 0;

  const gst =
    parseFloat(
      getMeta(
        metafields,
        "gst"
      )
    ) || 3;

  const goldValue =
    goldRate *
    weight *
    (purity / 24);

  const makingCharge =
    makingType === "flat"
      ? makingValue
      : goldValue *
        (makingValue / 100);

  const subtotal =
    goldValue +
    makingCharge +
    stoneCost;

  const finalPrice =
    subtotal *
    (1 + gst / 100);

  return Math.round(
    finalPrice
  );
}

// ─── 7. UPDATE VARIANT PRICE ─────────────────────────────────────
async function updateVariantPrice(
  token,
  variantId,
  price
) {

  const res =
    await fetch(
      `https://${SHOP}/admin/api/2025-01/variants/${variantId}.json`,
      {
        method: "PUT",

        headers: {
          "Content-Type":
            "application/json",

          "X-Shopify-Access-Token":
            token
        },

        body: JSON.stringify({
          variant: {
            id: variantId,
            price:
              price.toString()
          }
        })
      }
    );

  const data =
    await res.json();

  if (!data.variant) {

    console.error(
      `Variant update failed`,
      JSON.stringify(data)
    );

  } else {

    console.log(
      `Updated variant ${variantId}`
    );
  }
}

// ─── 8. MAIN ──────────────────────────────────────────────────────
async function run() {

  try {

    console.log(
      "Store:",
      SHOP
    );

    const token =
      await getShopifyToken();

    console.log(
      "Shopify token generated"
    );

    const goldRate =
      await getGoldRateINR();

    const products =
      await getProducts(
        token
      );

    console.log(
      `Found ${products.length} products`
    );

    for (const product of products) {

      try {

        const metafields =
          await getMetafields(
            token,
            product.id
          );

        const finalPrice =
          calculatePrice(
            goldRate,
            metafields
          );

        const variant =
          product.variants[0];

        await updateVariantPrice(
          token,
          variant.id,
          finalPrice
        );

        console.log(
          `✓ ${product.title} → ₹${finalPrice}`
        );

      } catch (err) {

        console.error(
          `✗ ${product.title}:`,
          err.message
        );
      }
    }

    console.log(
      "DONE"
    );

  } catch (err) {

    console.error(
      "Fatal error:",
      err.message
    );

    process.exit(1);
  }
}

run();
