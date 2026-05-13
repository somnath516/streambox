const express = require('express');
const { sendError } = require('../middleware/errorContract');
const asyncHandler = require('../utils/asyncHandler');

function createHealthRouter({ db }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    try {
      const movies = await db.getMovies();
      return res.json({ status: 'OK', uptime: process.uptime(), movies: movies.length });
    } catch {
      return sendError(res, 500, 'Internal server error');
    }
  }));

  router.get('/metrics', asyncHandler(async (req, res) => {
    const movies = await db.getMovies();
    const memory = process.memoryUsage();
    return res.json({
      status: 'OK',
      uptime: process.uptime(),
      movies: movies.length,
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
      },
      pid: process.pid,
      node: process.version,
    });
  }));

  return router;
}

module.exports = createHealthRouter;
