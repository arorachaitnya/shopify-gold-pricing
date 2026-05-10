// updated
const fetch = require("node-fetch");

const SHOP =
  process.env.SHOPIFY_STORE;

const TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN;

// FETCH LIVE GOLD RATE
async function getGoldRate() {

  const response =
    await fetch(
      "https://gold-api.com/api/XAU/USD"
    );

  const data =
    await response.json();

  // ounce → gram
  const usdPerGram =
    data.price / 31.1035;

  // approximate USD → INR
  const usdToInr = 83;

  return usdPerGram * usdToInr;
}

// FETCH PRODUCTS
async function getProducts() {

  const response =
    await fetch(
      `https://${SHOP}/admin/api/2025-01/products.json`,
      {
        headers: {
          "X-Shopify-Access-Token":
            TOKEN
        }
      }
    );

  const data =
    await response.json();

  return data.products;
}

// CALCULATE PRICE
function calculatePrice(
  goldRate
) {

  // TEMP VALUES
  // Later replaced by metafields

  const weight = 10;
  const purity = 22;
  const making = 12;
  const gst = 3;

  const goldValue =
    goldRate *
    weight *
    (purity / 24);

  const makingValue =
    goldValue *
    (making / 100);

  const subtotal =
    goldValue +
    makingValue;

  const final =
    subtotal *
    (1 + gst / 100);

  return Math.round(final);
}

// UPDATE VARIANT PRICE
async function updateVariant(
  variantId,
  price
) {

  await fetch(
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
}

// MAIN
async function run() {

  const goldRate =
    await getGoldRate();

  console.log(
    "Gold Rate:",
    goldRate
  );

  const products =
    await getProducts();

  for (const product of products) {

    const variant =
      product.variants[0];

    const finalPrice =
      calculatePrice(goldRate);

    console.log(
      product.title,
      finalPrice
    );

    await updateVariant(
      variant.id,
      finalPrice
    );
  }
}

run();
