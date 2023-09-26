const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
});
const supportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 1,
    skipSuccessfulRequests: true,
  });

module.exports = {
  authLimiter,
  supportLimiter
};
