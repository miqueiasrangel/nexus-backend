const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { sincronizarSEST } = require('../controllers/sestSyncController');

const router = express.Router();
const uploadDirectory = path.join(__dirname, '../../uploads');

fs.mkdirSync(uploadDirectory, { recursive: true });

const upload = multer({
  dest: uploadDirectory,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

router.post(
  '/sincronizacoes/sest',
  upload.single('base'),
  sincronizarSEST
);

module.exports = router;
