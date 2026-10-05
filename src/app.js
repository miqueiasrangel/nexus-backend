const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const importRoutes = require('./routes/importRoutes');
const sestRoutes = require('./routes/sestRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', importRoutes);
app.use('/api', sestRoutes);

module.exports = app;
