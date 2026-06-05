const fetch = require("node-fetch");

const SHOP = (process.env.SHOPIFY_STORE || "").trim();
const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
const GOLD_API_KEY = (process.env.GOLD_API_KEY || "").trim();

// ─── GOLD RATE ───────────────────────────────────────────────────────────────
async function getGoldRateINR() {
  const res = await fetch("https://www.goldapi.io/api/XAU/INR", {
    headers: {
      "x-access-token": GOLD_API_KEY,
      "Content-Type": "application/json"
    }
  });

  const data = await res.json();

  if (!data.price_gram_24k) {
    throw new Error("Could not fetch gold rate");
  }

  console.log(`Gold Rate (24k): ₹${data.price_gram_24k.toFixed(2)}/g`);

  return data.price_gram_24k;
}

// ─── PRODUCTS ────────────────────────────────────────────────────────────────
async function getProducts() {
  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/products.json?limit=250`,
    {
      headers: {
        "X-Shopify-Access-Token": TOKEN
      }
    }
  );

  const data = await res.json();

  return data.products.filter(
    p => p.title === "Plain Wave Band – Silver | Test"
  );
}

// ─── METAFIELDS ──────────────────────────────────────────────────────────────
async function getMetafields(productId) {

  const query = `
  {
    product(id: "gid://shopify/Product/${productId}") {
      metafields(first: 50) {
        edges {
          node {
            namespace
            key
            value
          }
        }
      }
    }
  }`;

  const res = await fetch(
    `https://${SHOP}/admin/api/2025-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      body: JSON.stringify({ query })
    }
  );

  const data = await res.json();

  return (
    data?.data?.product?.metafields?.edges?.map(
      e => e.node
    ) || []
  );
}

// ─── GET METAFIELD VALUE ─────────────────────────────────────────────────────
function getMeta(metafields, key) {
  const found = metafields.find(
    m => m.key.toLowerCase() === key.toLowerCase()
  );

  return found ? found.value : null;
}

// ─── PURITY ──────────────────────────────────────────────────────────────────
function getPurity(variant) {

  const text =
    [
      variant.title,
      variant.option1,
      variant.option2,
      variant.option3
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  if (text.includes("18kt") || text.includes("18k")) return 18;
  if (text.includes("14kt") || text.includes("14k")) return 14;
  if (text.includes("9kt") || text.includes("9k")) return 9;

  return 22;
}

// ─── SIZE MULTIPLIER ─────────────────────────────────────────────────────────
function getSizeMultiplier(size) {

  const s = parseInt(size);

  if (s <= 9) return 1;

  const jumps =
    Math.floor((s - 8) / 2);

  return Math.pow(1.07, jumps);
}

// ─── PRICE CALCULATION ───────────────────────────────────────────────────────
function calculatePrice(
  goldRate24k,
  metafields,
  purity,
  size
) {

  const baseWeight =
    parseFloat(
      getMeta(metafields, "weight")
    ) || 0;

  const stoneCost =
    parseFloat(
      getMeta(metafields, "stone_cost")
    ) || 0;

  const making =
    parseFloat(
      getMeta(metafields, "making_value")
    ) || 0;

  const gst =
    parseFloat(
      getMeta(metafields, "gst")
    ) || 0;

  const multiplier =
    getSizeMultiplier(size);

  const weight =
    baseWeight * multiplier;

  const goldValue =
    goldRate24k *
    (purity / 24) *
    weight;

  const subtotal =
    goldValue +
    stoneCost;

  const afterMaking =
    subtotal *
    (1 + making / 100);

  const finalPrice =
    afterMaking *
    (1 + gst / 100);

  return Math.round(finalPrice);
}

// ─── UPDATE VARIANT ──────────────────────────────────────────────────────────
async function updateVariantPrice(
  variantId,
  price
) {

  await fetch(
    `https://${SHOP}/admin/api/2025-01/variants/${variantId}.json`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      body: JSON.stringify({
        variant: {
          id: variantId,
          price: price.toString()
        }
      })
    }
  );
}

// ─── DELAY (Shopify rate-limit protection) ───────────────────────────────────
function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function run() {

  try {

    const goldRate24k =
      await getGoldRateINR();

    const products =
      await getProducts();

    console.log(
      `Processing ${products.length} product(s)\n`
    );

    for (const product of products) {

      const metafields =
        await getMetafields(product.id);

      for (const variant of product.variants) {

        const purity =
          getPurity(variant);

        const size =
          parseInt(
            variant.option1
          );

        const finalPrice =
          calculatePrice(
            goldRate24k,
            metafields,
            purity,
            size
          );

        console.log(
          `${variant.title} → ₹${finalPrice}`
        );

        await updateVariantPrice(
          variant.id,
          finalPrice
        );

        await sleep(500);
      }
    }

    console.log("\n✓ DONE");

  } catch (err) {

    console.error(
      "\nFATAL:",
      err.message
    );

    process.exit(1);
  }
}

run();
