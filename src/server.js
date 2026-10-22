const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Clinic Booking Server running on port ${PORT}`);
  console.log(`API Key configured: ${process.env.API_KEY ? 'Custom' : 'Default (clinic-secret-key-2026)'}`);
  console.log(`Web interface accessible at http://localhost:${PORT}`);
});
