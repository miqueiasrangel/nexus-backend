const express = require('express');
const cors = require('cors');

const importRoutes = require('./routes/importRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', importRoutes);

module.exports = app;
