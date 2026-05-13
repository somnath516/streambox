const crypto = require('crypto');
const logger = require('../utils/logger');

function sendError(res, code, message) {
  return res.status(code).json({ error: message });
}

function createErrorContractHandler() {
  return function errorContract(err, req, res, next) {
    try {
      const msg = typeof err?.message === 'string' ? err.message : '';

      // JSON / body parsing errors
      if (err instanceof SyntaxError) {
        return sendError(res, 400, 'Request failed');
      }

      // Multer / upload errors
      if (err && (err.name === 'MulterError' || msg === 'Upload rejected')) {
        return sendError(res, 400, 'Request failed');
      }

      logger.error('request_error', {
        requestId: req.id,
        errorId: crypto.randomUUID(),
        status: 500,
        message: msg || 'Unhandled error',
      });
      return sendError(res, 500, 'Internal server error');
    } catch (e) {
      return sendError(res, 500, 'Internal server error');
    }
  };
}

module.exports = { sendError, createErrorContractHandler };

