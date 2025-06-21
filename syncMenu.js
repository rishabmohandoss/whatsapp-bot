const axios = require("axios");
const fs = require("fs");
const csv = require("csv-parser");

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS98jCobml-ttjMGNhmUyDiasFfS5dB-xw4I5Gos6KRBozaLIOWIyJ8bvXyKkotQouRMu46SWd6lQrq/pub?output=csv";

async function updateMenuFromSheet() {
  const response = await axios.get(SHEET_CSV_URL, { responseType: 'stream' });

  const menus = {};

  response.data
    .pipe(csv())
    .on("data", (rawRow) => {
      // Normalize keys: trim and lowercase
      const row = {};
      Object.keys(rawRow).forEach((key) => {
        row[key.trim().toLowerCase()] = rawRow[key];
      });

      const restaurant = row["name"]?.trim().toLowerCase();
      const item = row["item"]?.trim().toLowerCase();
      const price = parseFloat(row["price"]);

      if (restaurant && item && !isNaN(price)) {
        if (!menus[restaurant]) menus[restaurant] = {};
        menus[restaurant][item] = price;
      } else {
        console.warn("⚠️ Skipped bad row:", rawRow);
      }
    })
    .on("end", () => {
      fs.writeFileSync("menu.json", JSON.stringify(menus, null, 2));
      console.log("✅ menu.json updated from Google Sheets");
    });
}

updateMenuFromSheet();
