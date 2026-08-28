import dns from 'node:dns/promises';

type Probe = { dns: 'ok' | 'failed'; tcp: 'ok' | 'failed' | 'not_tested'; tls: 'ok' | 'failed' | 'not_tested'; http: 'ok' | 'failed' | 'not_tested'; error?: string };

const timeoutMs = Math.max(1000, Number(process.env.HTTP_TOTAL_TIMEOUT || 15000));

export async function probeExternalSource(url = 'https://necn.ac.in/'): Promise<Probe> {
  const result: Probe = { dns: 'failed', tcp: 'not_tested', tls: 'not_tested', http: 'not_tested' };
  let hostname: string;
  try { hostname = new URL(url).hostname; } catch { return { ...result, error: 'invalid_url' }; }
  try {
    await dns.lookup(hostname);
    result.dns = 'ok';
  } catch (error) {
    result.error = `dns:${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'NECN-NEXA-HealthCheck/1.0' }
    });
    result.tcp = 'ok';
    result.tls = 'ok';
    result.http = response.ok || response.status < 500 ? 'ok' : 'failed';
    if (!response.ok) result.error = `http_status:${response.status}`;
  } catch (error) {
    const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
    result.error = message;
    result.tcp = 'failed';
    result.tls = message.toLowerCase().includes('tls') ? 'failed' : 'not_tested';
    result.http = 'not_tested';
  }
  return result;
}
