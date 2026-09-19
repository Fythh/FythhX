const { machineIdSync } = require('node-machine-id');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Secret salt for basic protection. In real-world, this might be RSA logic.
const SECRET_SALT = 'FytX_SuperSecret_2026!';

/**
 * Mendapatkan ID unik dari Hardware (Motherboard/Harddisk)
 */
function getHardwareId() {
    try {
        return machineIdSync(true); 
    } catch (err) {
        return 'UNKNOWN_HARDWARE_ID';
    }
}

/**
 * Generate License berdasarkan Hardware ID
 * Hanya digunakan oleh Admin (pembuat aplikasi)
 */
function generateLicenseKey(hwid) {
    return crypto.createHash('sha256').update(hwid + SECRET_SALT).digest('hex');
}

/**
 * Memverifikasi Lisensi saat aplikasi berjalan
 */
function verifyLicense() {
    // DEV MODE: Jika tidak berjalan di dalam .exe buatan 'pkg', loloskan otomatis.
    if (!process.pkg) {
        return { valid: true, hwid: getHardwareId(), isDev: true };
    }

    // PROD MODE: Berjalan di dalam .exe
    const hwid = getHardwareId();
    const expectedKey = generateLicenseKey(hwid);
    
    // Cari file license.key di sebelah file .exe
    const licensePath = path.join(process.cwd(), 'license.key');

    if (!fs.existsSync(licensePath)) {
        return { valid: false, hwid, reason: 'File license.key tidak ditemukan di folder aplikasi.' };
    }

    const providedKey = fs.readFileSync(licensePath, 'utf8').trim();

    if (providedKey === expectedKey) {
        return { valid: true, hwid };
    } else {
        return { valid: false, hwid, reason: 'Kunci Lisensi tidak valid atau Hardware berbeda.' };
    }
}

module.exports = {
    getHardwareId,
    verifyLicense,
    generateLicenseKey
};
