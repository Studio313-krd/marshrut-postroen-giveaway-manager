export function networkSettings(env = process.env) {
  const publicURL = env.PUBLIC_URL ? new URL(env.PUBLIC_URL) : null;
  if (publicURL && (!['http:', 'https:'].includes(publicURL.protocol) || publicURL.username || publicURL.password || publicURL.pathname !== '/' || publicURL.search || publicURL.hash)) {
    throw new Error('PUBLIC_URL must be an HTTP(S) origin without a path or credentials');
  }
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(publicURL ? [publicURL.hostname] : [])]);
  return {
    host: env.HOST || '127.0.0.1',
    secureCookies: publicURL?.protocol === 'https:',
    allowsHost(host) {
      try { return hosts.has(new URL(`http://${host}`).hostname); } catch { return false; }
    },
    allowsOrigin(req) {
      if (!req.headers.origin) return true;
      return req.headers.origin === (publicURL?.origin || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`);
    },
  };
}
