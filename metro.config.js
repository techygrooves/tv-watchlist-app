// Metro config — required for expo-sqlite on web:
// the SQLite web worker loads a wa-sqlite WASM binary, so Metro must treat
// .wasm as an asset, and the dev server must send COOP/COEP headers so the
// browser allows SharedArrayBuffer for the worker.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    middleware(req, res, next);
  };
};

module.exports = config;
