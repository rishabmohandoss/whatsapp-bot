const axios = require("axios");
const fs = require("fs");
const csv = require("csv-parser");

const SHEET_CSV_URL = "YOUR_CSV_LINK_HERE";

async function updateMenuFromSheet() {
  const response = await axios.get(SHEET_CSV_URL, { responseType: 'stream' });

  const menus = {};

  response.data
    .pipe(csv())
    .on("data", (row) => {
      const restaurant = row["Name"]?.trim().toLowerCase();
      const item = row["Item"]?.trim().toLowerCase();
      const price = parseFloat(row["Price"]);

      if (restaurant && item && !isNaN(price)) {
        if (!menus[restaurant]) menus[restaurant] = {};
        menus[restaurant][item] = price;
      } else {
        console.warn("⚠️ Skipped bad row:", row);
      }
    })
    .on("end", () => {
      fs.writeFileSync("menu.json", JSON.stringify(menus, null, 2));
      console.log("✅ menu.json updated from Google Sheets");
    });
}

updateMenuFromSheet();
