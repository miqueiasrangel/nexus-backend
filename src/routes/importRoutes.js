const express = require('express');
const multer = require('multer');
const { importarArquivos } = require('../controllers/importController');

const router = express.Router();

const upload = multer({
  dest: 'uploads/'
});

router.post(
  '/importar',
  upload.fields([
    { name: 'csv', maxCount: 2 },
    { name: 'csv2', maxCount: 1 },
    { name: 'xls', maxCount: 1 }
  ]),
  importarArquivos
);

module.exports = router;
