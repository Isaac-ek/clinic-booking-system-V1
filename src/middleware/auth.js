function authMiddleware(req, res, next) {
  const expectedApiKey = process.env.API_KEY || 'clinic-secret-key-2026';
  const providedApiKey = req.header('X-API-Key');

  if (!providedApiKey || providedApiKey !== expectedApiKey) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid X-API-Key header' });
  }

  next();
}

module.exports = authMiddleware;
