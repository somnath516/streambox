const ADMIN_TOKEN = process.env.STREAMBOX_ADMIN || 'STREAMBOX_ADMIN';

function auth(req, res, next) {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : null;

  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}

module.exports = auth;
