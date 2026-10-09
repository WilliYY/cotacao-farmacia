import { createHash } from 'node:crypto';

// Session storage names contain only a digest; existing supplier profiles stay untouched.
export function getConnectorSessionIdentity(supplierId, credentials = {}) {
  return createHash('sha256').update(JSON.stringify([
    String(supplierId), String(credentials.loginUrl || ''),
    String(credentials.username || ''), String(credentials.clientCode || ''),
    String(credentials.password || '')
  ])).digest('hex');
}
