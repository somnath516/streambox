const helmet = require('helmet');

function createSecurityHeaders() {
  const enableCsp = process.env.ENABLE_CSP === '1' || process.env.NODE_ENV === 'production';

  return helmet({
    contentSecurityPolicy: enableCsp ? {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Allow inline event handlers for legacy admin templates while keeping CSP otherwise strict.
        // This avoids Render console "script-src-attr 'none'" blocks.
        // Frontend JS should still migrate to addEventListener, but runtime will not break.
        upgradeInsecureRequests: null,
      },
    } : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
  });
}

module.exports = createSecurityHeaders;
