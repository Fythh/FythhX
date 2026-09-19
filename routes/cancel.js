/**
 * Cancel Route
 * 
 * POST /api/cancel - Membatalkan proses download yang sedang berjalan
 */

const express = require('express');
const router = express.Router();
const ytDlpService = require('../services/ytDlpService');

/**
 * POST /api/cancel
 * Membatalkan download media
 */
router.post('/cancel', (req, res) => {
  try {
    const success = ytDlpService.cancelDownload();
    
    if (success) {
      res.json({
        success: true,
        message: 'Download berhasil dibatalkan'
      });
    } else {
      res.json({
        success: false,
        message: 'Tidak ada proses download yang sedang berjalan'
      });
    }
  } catch (error) {
    console.error('Cancel error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
