const { generateLicenseKey } = require('../services/licenseService');
const fs = require('fs');
const path = require('path');

const hwid = process.argv[2];

if (!hwid) {
    console.error("Gagal: Harap masukkan Hardware ID!");
    console.error("Cara penggunaan: node scripts/generateLicense.js <HARDWARE_ID_KLIEN>");
    process.exit(1);
}

console.log(`Membuat lisensi untuk Hardware ID: ${hwid} ...`);
const key = generateLicenseKey(hwid);

const outputPath = path.join(process.cwd(), 'license.key');
fs.writeFileSync(outputPath, key);

console.log(`\nBERHASIL!`);
console.log(`Kunci Lisensi: ${key}`);
console.log(`File 'license.key' telah dibuat di: ${outputPath}`);
console.log(`Kirimkan file ini ke klien Anda.`);
