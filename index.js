const fetch = require("node-fetch");

const SHOP         = (process.env.SHOPIFY_STORE || "").trim();
const TOKEN        = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
const GOLD_API_KEY = (process.env.GOLD_API_KEY || "").trim();

console.log("SHOP        :", SHOP);
console.log("TOKEN prefix:", TOKEN.slice(0, 10));
console.log("GOLD KEY pfx:", GOLD_API_KEY.slice(0, 10));

// ─── 1. GOLD RATE (INR per gram, 24k) ────────────────────────────────────────
async function getGoldRateINR() {
  const res  = await fetch("https://www.goldapi.io/api/XAU/INR", {
    headers: { "x-access-token": GOLD_API_KEY, "Content-Type": "application/json" }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GoldAPI HTTP ${res.status}: ${text}`);
  const data = JSON.parse(text);
  if (!data.price_gram_24k) throw new Error(`No price_gram_24k in response: ${text.slice(0,200)}`);
  console.log(`\nGold Rate (24k): ₹${data.price_gram_24k.toFixed(2)}/gram\n`);
  return data.price_gram_24k;
}

// ─── 2. FETCH ALL PRODUCTS ───────────────────────────────────────────────────
async function getProducts() {
  const url = `https://${SHOP}/admin/api/2025-01/products.json?limit=250`;
  const res  = await fetch(url, { headers: { "X-Shopify-Access-Token": TOKEN } });
  const text = await res.text();
  console.log("Shopify response:", text.slice(0, 300));
  const data = JSON.parse(text);
  if (!data.products) throw new Error(`Cannot fetch products: ${text.slice(0,300)}`);
  console.log(`Found ${data.products.length} product(s)\n`);
  return data.products.filter(
  p => p.title === "Plain Wave Band – Silver | Test"
);
}

// ─── 3. FETCH METAFIELDS ─────────────────────────────────────────────────────
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

  console.log(
    "GRAPHQL METAFIELDS:",
    JSON.stringify(data, null, 2)
  );

  return (
    data?.data?.product?.metafields?.edges?.map(e => e.node) || []
  );
}

// ─── 4. GET METAFIELD VALUE BY KEY ───────────────────────────────────────────
function getMeta(metafields, key) {
  const found = metafields.find((m) => m.key.toLowerCase() === key.toLowerCase());
  return found ? found.value : null;
}

// ─── 5. DETECT PURITY FROM VARIANT TITLE (18k, 14k, 9k) ─────────────────────
function getPurity(variant) {
  const text = [variant.title, variant.option1, variant.option2, variant.option3]
    .filter(Boolean).join(" ").toLowerCase();
  if (text.includes("18kt") || text.includes("18k")) return 18;
  if (text.includes("14kt") || text.includes("14k")) return 14;
  if (text.includes("9kt")  || text.includes("9k"))  return 9;
  return 22; // default fallback
}

// ─── 6. CALCULATE PRICE ──────────────────────────────────────────────────────
// Formula:
//   goldValue  = goldRate24k × (purity/24) × weight
//   subtotal   = goldValue + stoneCost
//   afterMaking= subtotal × (1 + making/100)
//   finalPrice = afterMaking × (1 + gst/100)
function calculatePrice(goldRate24k, metafields, purity) {
  const weight      = parseFloat(getMeta(metafields, "weight"))       || 0;
  const stoneCost   = parseFloat(getMeta(metafields, "stone_cost"))   || 0;
  const making      = parseFloat(getMeta(metafields, "making_value")) || 0;
  const gst         = parseFloat(getMeta(metafields, "gst"))          || 0;

  const goldValue   = goldRate24k * (purity / 24) * weight;
  const subtotal    = goldValue + stoneCost;
  const afterMaking = subtotal * (1 + making / 100);
  const finalPrice  = afterMaking * (1 + gst / 100);

  console.log({
  weight,
  stoneCost,
  making,
  gst,
  purity,
  goldRate24k
});

  return Math.round(finalPrice);
}

// ─── 7. UPDATE VARIANT PRICE ON SHOPIFY ──────────────────────────────────────
async function updateVariantPrice(variantId, price) {
  const res  = await fetch(
    `https://${SHOP}/admin/api/2025-01/variants/${variantId}.json`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      body: JSON.stringify({ variant: { id: variantId, price: price.toString() } })
    }
  );
  const data = await res.json();
  if (!data.variant) {
    console.error(`  ✗ Failed variant ${variantId}:`, JSON.stringify(data));
  }
}

// ─── 8. MAIN ─────────────────────────────────────────────────────────────────
async function run() {
  try {
    const goldRate24k = await getGoldRateINR();
    const products    = await getProducts();

    for (const product of products) {
      try {
        const metafields = await getMetafields(product.id);

        for (const variant of product.variants) {

  console.log({
    title: variant.title,
    option1: variant.option1,
    option2: variant.option2,
    option3: variant.option3
  });
          const purity     = getPurity(variant);
          const finalPrice = calculatePrice(goldRate24k, metafields, purity);

          console.log(`  → "${product.title}" [${variant.title}] | ${purity}k | ₹${finalPrice}`);
          await updateVariantPrice(variant.id, finalPrice);
          console.log(`    ✓ Updated`);
        }
      } catch (err) {
        console.error(`  ✗ "${product.title}": ${err.message}`);
      }
    }

    console.log("\n✓ ALL PRODUCTS UPDATED");
  } catch (err) {
    console.error("\nFATAL:", err.message);
    process.exit(1);
  }
}

run();
