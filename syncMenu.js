const axios = require("axios");
const fs = require("fs");
const csv = require("csv-parser");

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS98jCobml-ttjMGNhmUyDiasFfS5dB-xw4I5Gos6KRBozaLIOWIyJ8bvXyKkotQouRMu46SWd6lQrq/pub?output=csv";

async function updateMenuFromSheet() {
  const response = await axios.get(SHEET_CSV_URL, { responseType: 'stream' });

  const menus = {};

  response.data
    .pipe(csv())
    .on("data", (row) => {
      const restaurant = row.restaurant.trim().toLowerCase();
      const item = row.item.trim().toLowerCase();
      const price = parseFloat(row.price);

      if (!menus[restaurant]) menus[restaurant] = {};
      menus[restaurant][item] = price;
    })
    .on("end", () => {
      fs.writeFileSync("menu.json", JSON.stringify(menus, null, 2));
      console.log("✅ Menu updated from Google Sheets");
    });
}

updateMenuFromSheet();
