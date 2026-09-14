const http = require("http");
const https = require("https");
const {
  buildAutoxposeEndpoint,
  resolveAutoxposeUrl,
} = require("./autoxpose-url");

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function createPinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    let lookupOptions = options;
    let done = callback;
    if (typeof options === "function") {
      lookupOptions = {};
      done = options;
    }
    const requestedFamily = Number(lookupOptions?.family) || 0;
    const candidates = requestedFamily
      ? addresses.filter(({ family }) => family === requestedFamily)
      : addresses;
    if (!candidates.length) {
      const error = new Error("No validated Autoxpose address matches the requested family");
      error.code = "ENOTFOUND";
      done(error);
      return;
    }
    if (lookupOptions?.all) {
      done(null, candidates);
      return;
    }
    done(null, candidates[0].address, candidates[0].family);
  };
}

function parseJson(chunks) {
  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body);
}

async function requestAutoxposeJson(baseUrl, endpoint, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES;

  return new Promise((resolve, reject) => {
    let settled = false;
    let request = null;
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const fail = (error) => settle(() => reject(error));

    const timeout = setTimeout(() => {
      const error = new Error("Autoxpose request timed out");
      fail(error);
      request?.destroy();
    }, timeoutMs);

    Promise.resolve()
      .then(async () => {
        const resolution = await resolveAutoxposeUrl(baseUrl, {
          lookup: options.lookup,
        });
        if (settled) return;
        const target = new URL(buildAutoxposeEndpoint(resolution.url, endpoint));
        const requestImplementation = options.request || (
          target.protocol === "https:" ? https.request : http.request
        );

        request = requestImplementation(target, {
          method: options.method || "GET",
          headers: { Accept: "application/json", ...options.headers },
          lookup: createPinnedLookup(resolution.addresses),
          agent: false,
        }, (response) => {
          const status = response.statusCode || 0;
          const ok = status >= 200 && status < 300;
          if (!ok) {
            settle(() => resolve({ ok: false, status, data: null, url: resolution.url }));
            response.destroy();
            return;
          }

          const chunks = [];
          let size = 0;
          response.on("data", (chunk) => {
            const buffer = Buffer.from(chunk);
            size += buffer.length;
            if (size > maxResponseBytes) {
              const error = new Error("Autoxpose response exceeds the size limit");
              error.code = "RESPONSE_TOO_LARGE";
              fail(error);
              response.destroy();
              request?.destroy();
              return;
            }
            chunks.push(buffer);
          });
          response.once("error", fail);
          response.once("end", () => {
            if (settled) return;
            try {
              const data = parseJson(chunks);
              settle(() => resolve({ ok: true, status, data, url: resolution.url }));
            } catch {
              fail(new Error("Autoxpose returned invalid JSON"));
            }
          });
        });

        request.once("error", fail);
        request.end();
      })
      .catch(fail);
  });
}

module.exports = {
  createPinnedLookup,
  requestAutoxposeJson,
};