const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { initializeBot, getLastQrCode } = require('./bot');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middlewares
app.use(bodyParser.json());
app.use(express.json());

// Servir index.html na rota '/'
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/qrcode', (req, res) => {
    const qr = getLastQrCode();
    if (!qr) {
        return res.status(404).json({ error: 'QR code não disponível no momento.' });
    }
    res.json({ qrcode: qr });
});

// Iniciar o servidor Express e o bot
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    initializeBot();
});