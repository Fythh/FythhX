/**
 * Fetch Routes
 * 
 * POST /api/fetch - Mengambil metadata dari URL
 */

const express = require('express');
const router = express.Router();
const ytDlpService = require('../services/ytDlpService');
const shopeeService = require('../services/shopeeVideoService'); // tambahin ini

/**
 * POST /api/fetch
 * Fetch metadata dari URL
 */
router.post('/fetch', async (req, res) => {
  try {
    const { url } = req.body;

    // Validasi input
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'URL harus diisi'
      });
    }

    // Validasi format URL
    const urlPattern = /^(https?:\/\/)?(www\.)?.+/;
    if (!urlPattern.test(url)) {
      return res.status(400).json({
        success: false,
        error: 'Format URL tidak valid'
      });
    }

    // Fetch metadata
    const browser = req.body.browser || 'none';

        if (shopeeService.isShopeeVideoUrl(url)) {
      const metadata = await shopeeService.fetchMetadata(url);
      return res.json({ success: true, data: metadata });
    }

    const metadata = await ytDlpService.fetchMetadata(url, browser);

    res.json({
      success: true,
      data: metadata
    });

  } catch (error) {
    console.error('Fetch error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
