require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

// Configure CORS to allow requests from your frontend
let allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
// Remove trailing slash if present, as browsers send the origin without it
if (allowedOrigin.endsWith('/')) {
    allowedOrigin = allowedOrigin.slice(0, -1);
}
// Ensure protocol is present
if (!allowedOrigin.startsWith('http')) {
    allowedOrigin = `https://${allowedOrigin}`;
}

app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

const dataRoutes = require('./routes/dataRoutes');
app.use('/api', dataRoutes);

app.get('/', (req, res) => {
    res.send('Marketing Performance Backend is running.');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
