const axios = require('axios');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// Replace with your published XLSX URL
const SHEET_XLSX_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS98jCobml-ttjMGNhmUyDiasFfS5dB-xw4I5Gos6KRBozaLIOWIyJ8bvXyKkotQouRMu46SWd6lQrq/pub?output=xlsx';

async function updateMenuFromSheet() {
  try {
    const response = await axios.get(SHEET_XLSX_URL, {
      responseType: 'arraybuffer'
    });

    const workbook = xlsx.read(response.data, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;

    const result = {};

    sheetNames.forEach(sheet => {
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheet], { defval: "" });

      // Overview / Metadata sheet
      if (sheet.toLowerCase().includes("overview")) {
        const meta = {};
        rows.forEach(row => {
          const [key, value] = Object.entries(row)[0];
          if (key && value) {
            const normalizedKey = key.toLowerCase().replace(/\s+/g, "_");
            meta[normalizedKey] = value;
          }
        });
        result.meta = meta;
      } else {
        // Menu sections
        result.menu = result.menu || {};
        result.menu[sheet] = {};
        rows.forEach(row => {
          const name = row.Name?.trim();
          const price = parseFloat((row.Price || "").toString().replace(/[^0-9.]/g, ""));
          if (name && !isNaN(price)) {
            result.menu[sheet][name.toLowerCase()] = price;
          }
        });
      }
    });

    fs.writeFileSync("menu.json", JSON.stringify(result, null, 2));
    console.log("✅ menu.json updated from Google Sheets");
  } catch (err) {
    console.error("❌ Failed to update menu from Google Sheets:", err.message);
  }
}

updateMenuFromSheet();
