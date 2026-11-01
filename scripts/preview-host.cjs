// Installed locally beside Coo's main.cjs, never shipped or activated on extension install.
exports.allows = function allows(request, coreOrigin) {
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin === coreOrigin) return false;
    if (!['GET','HEAD'].includes(request.method)) return false;
    if (!/^\/figure-preview\/[a-f0-9-]{36}\/(frame\.html|web\/|pack\/)/.test(url.pathname)) return false;
    const from = request.referrer ? new URL(request.referrer).origin : null;
    return !from || from === coreOrigin || from === url.origin;
  } catch { return false; }
};
exports.clean = function clean(request) {
  const headers = new Headers(request.headers);
  for (const key of ['cookie','authorization','proxy-authorization']) headers.delete(key);
  return new Request(request, {headers});
};
