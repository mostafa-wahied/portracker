const { rateLimit } = require("express-rate-limit");

function configuredLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function operationLimit(limit, windowMs = 60000) {
  return rateLimit({
    windowMs, limit, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "Too many requests; retry after the indicated delay" },
  });
}

const generatePortLimit = operationLimit(configuredLimit("GENERATE_PORT_REQUESTS_PER_MINUTE", 30));
const pingRequestLimit = operationLimit(configuredLimit("PING_REQUESTS_PER_MINUTE", 6000));

module.exports = { generatePortLimit, pingRequestLimit, operationLimit };