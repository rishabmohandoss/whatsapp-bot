const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const filePath = './Restaurant Ordering System.xlsx'; // Update this path if needed
const outputPath = './menu.json';

if (!fs.existsSync(filePath)) {
  console.error(`❌ File not found: ${filePath}`);
  process.exit(1);
}

try {
  const workbook = xlsx.readFile(filePath);
  const sheetNames = workbook.SheetNames;

  const metadataSheet = workbook.Sheets[sheetNames[0]];
  const metadataRaw = xlsx.utils.sheet_to_json(metadataSheet, { header: 1 });

  const metadata = {};
  for (let i = 0; i < metadataRaw.length; i++) {
    const row = metadataRaw[i];
    if (row[0] && row[1]) {
      metadata[row[0].trim()] = row[1].toString().trim();
    }
  }

  const menu = {};

  for (let i = 1; i < sheetNames.length; i++) {
    const section = sheetNames[i];
    const sheet = workbook.Sheets[section];
    const rows = xlsx.utils.sheet_to_json(sheet);

    const items = rows
      .filter(row => row.Name && row.Price)
      .map(row => ({
        name: row.Name.toString().trim(),
        description: row.Description?.toString().trim() || "",
        price: parseFloat(row.Price.toString().replace('$', '').trim())
      }));

    if (items.length > 0) {
      menu[section] = items;
    }
  }

  const finalJson = {
    metadata,
    menu
  };

  fs.writeFileSync(outputPath, JSON.stringify(finalJson, null, 2));
  console.log(`✅ Menu exported to ${outputPath}`);
} catch (err) {
  console.error("❌ Failed to parse Excel file:", err.message);
  process.exit(1);
}
