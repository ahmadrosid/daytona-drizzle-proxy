#!/usr/bin/env node

import http from 'http';
import https from 'https';
import { URL } from 'url';
import net from 'net';
import { Command } from 'commander';

const VERSION = '1.3.0';

interface Config {
  port: number;
  target: string;
}

function addCorsHeaders(res: http.ServerResponse, origin?: string) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('X-Daytona-Disable-CORS', 'true');
}

async function makeProxyRequest(
  url: URL,
  method: string,
  headers: Record<string, string | string[]>,
  body: Buffer,
  useHttps: boolean
): Promise<{ res: http.IncomingMessage, error?: any }> {
  return new Promise((resolve) => {
    const client = useHttps ? https : http;
    
    const options: http.RequestOptions | https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (useHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method || 'GET',
      headers: headers,
      // Enhanced SSL options for better compatibility
      ...(useHttps ? { 
        rejectUnauthorized: false,
        secureProtocol: 'TLS_method',
        ciphers: 'DEFAULT',
        secureOptions: 0
      } : {})
    };

    const proxyReq = client.request(options, (proxyRes) => {
      resolve({ res: proxyRes });
    });

    proxyReq.on('error', (error) => {
      resolve({ res: null as any, error });
    });

    // Write request body if present
    if (body.length > 0 && method !== 'GET' && method !== 'HEAD') {
      proxyReq.write(body);
    }
    
    proxyReq.end();
  });
}

async function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse, targetUrl: string) {
  const url = new URL(req.url || '/', targetUrl);
  
  // Get request body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  // Prepare headers
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key !== 'host' && key !== 'origin' && value) {
      headers[key] = value;
    }
  }
  
  // Try with the specified protocol first
  let useHttps = url.protocol === 'https:';
  let result = await makeProxyRequest(url, req.method || 'GET', headers, body, useHttps);
  
  // If we get EPROTO error, it might be wrong protocol - try the opposite
  if (result.error && (result.error as any).code === 'EPROTO') {
    console.log(`⚠️  SSL/Protocol error detected. Error details:`, result.error.message);
    console.log(`   Attempting fallback to ${useHttps ? 'HTTP' : 'HTTPS'}...`);
    useHttps = !useHttps;
    result = await makeProxyRequest(url, req.method || 'GET', headers, body, useHttps);
    
    // If still failing with HTTPS, provide more diagnostic info
    if (result.error && useHttps) {
      console.log(`❌ SSL connection failed. Common causes:`);
      console.log(`   - Server is using HTTP, not HTTPS`);
      console.log(`   - Self-signed certificate issues`);
      console.log(`   - TLS version mismatch`);
      console.log(`   Error: ${result.error.message}`);
    }
  }
  
  if (result.error) {
    const errorDetails = result.error instanceof Error 
      ? { 
          message: result.error.message, 
          code: (result.error as any).code,
          cause: (result.error as any).cause
        }
      : { message: 'Unknown error' };
    
    console.error('❌ Proxy error:', {
      url: req.url,
      method: req.method,
      target: targetUrl,
      error: errorDetails
    });
    
    if (!res.headersSent) {
      addCorsHeaders(res, req.headers.origin);
      res.writeHead(502, 'Bad Gateway', { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Proxy request failed',
        message: errorDetails.message,
        details: {
          target: targetUrl,
          method: req.method,
          path: req.url,
          code: errorDetails.code
        }
      }));
    }
    return;
  }
  
  // Success - forward the response
  const proxyRes = result.res;
  
  // First, explicitly remove any CORS headers from the proxy response
  const corsHeadersToRemove = [
    'access-control-allow-origin',
    'access-control-allow-methods', 
    'access-control-allow-headers',
    'access-control-allow-credentials',
    'access-control-expose-headers',
    'access-control-max-age'
  ];
  
  corsHeadersToRemove.forEach(header => {
    // Remove both lowercase and any case variations
    Object.keys(proxyRes.headers).forEach(key => {
      if (key.toLowerCase() === header) {
        delete proxyRes.headers[key];
      }
    });
  });
  
  // Copy remaining response headers (CORS ones already removed)
  Object.entries(proxyRes.headers).forEach(([key, value]) => {
    if (value) {
      res.setHeader(key, value);
    }
  });
  
  // Now add our CORS headers last so they overwrite anything
  addCorsHeaders(res, req.headers.origin);
  
  // Set status code
  res.writeHead(proxyRes.statusCode || 200, proxyRes.statusMessage);
  
  // Pipe the response
  proxyRes.pipe(res);
}

function startProxy(config: Config) {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    
    console.log(`${req.method} ${req.url} (origin: ${origin || 'none'})`);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      addCorsHeaders(res, origin);
      res.writeHead(204);
      res.end();
      return;
    }

    // Handle /studio and /cdn-cgi routes - proxy to drizzle studio CDN
    if (req.url?.startsWith('/studio') || req.url?.startsWith('/cdn-cgi')) {
      const originalUrl = req.url;
      
      if (req.url.startsWith('/studio')) {
        // Strip /studio prefix and proxy to drizzle CDN
        const studioPath = req.url.replace(/^\/studio/, '') || '/';
        req.url = studioPath;
        console.log(`🎨 Studio route: ${originalUrl} → https://local.drizzle.studio${studioPath}`);
      } else {
        // Keep /cdn-cgi path as-is
        console.log(`☁️ CDN route: ${originalUrl} → https://local.drizzle.studio${originalUrl}`);
      }
      
      await proxyRequest(req, res, 'https://local.drizzle.studio');
      return;
    }

    await proxyRequest(req, res, config.target);
  });

  server.listen(config.port, () => {
    console.log(`🚀 Daytona Drizzle Proxy v${VERSION}`);
    console.log(`📡 Listening on: http://localhost:${config.port}`);
    console.log(`🎯 Forwarding to: ${config.target}`);
    console.log(`🌐 CORS enabled for all origins`);
    console.log('\\nPress Ctrl+C to stop');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\\n🛑 Shutting down...');
    server.close(() => {
      console.log('✅ Goodbye!');
      process.exit(0);
    });
  });
}

// Main execution
async function main() {
  const program = new Command();
  
  program
    .name('daytona-drizzle-proxy')
    .description('Simple CORS proxy for Drizzle Studio in Daytona environments')
    .version(VERSION, '-v, --version', 'Show version')
    .option('-p, --port <number>', 'Proxy server port', '8080')
    .option('-t, --target <url>', 'Target Drizzle Studio URL', 'http://localhost:4983')
    .addHelpText('after', `
EXAMPLES:
  daytona-drizzle-proxy
    Start proxy on port 8080, forwarding to localhost:4983

  daytona-drizzle-proxy --port 9000 --target http://localhost:4983
    Start proxy on port 9000, forwarding to localhost:4983

USAGE:
  1. Start Drizzle Studio: drizzle-kit studio
  2. Start this proxy: daytona-drizzle-proxy  
  3. Use proxy URL: http://localhost:8080
  4. Or access studio directly: http://localhost:8080/studio

ROUTES:
  /studio/**  - Proxies to Drizzle Studio CDN (https://local.drizzle.studio)
  /cdn-cgi/** - Proxies to Drizzle Studio CDN (https://local.drizzle.studio)
  /**         - Proxies to your configured target (default: localhost:4983)`)
    .parse(process.argv);

  const options = program.opts();
  
  const port = parseInt(options.port);
  if (isNaN(port) || port <= 0 || port > 65535) {
    console.error(`❌ Invalid port: ${options.port}`);
    process.exit(1);
  }
  
  const config: Config = {
    port,
    target: options.target
  };
  
  try {
    // Quick connectivity check
    console.log(`🔍 Testing connection to ${config.target}...`);
    try {
      const testUrl = new URL(config.target);
      const client = testUrl.protocol === 'https:' ? https : http;
      
      await new Promise<void>((resolve, reject) => {
        const options: http.RequestOptions | https.RequestOptions = {
          hostname: testUrl.hostname,
          port: testUrl.port || (testUrl.protocol === 'https:' ? 443 : 80),
          path: '/',
          method: 'GET',  // Changed from HEAD to GET as some servers don't support HEAD
          timeout: 3000,
          ...(testUrl.protocol === 'https:' ? { 
            rejectUnauthorized: false,
            secureProtocol: 'TLS_method',
            ciphers: 'DEFAULT',
            secureOptions: 0
          } : {})
        };
        
        const req = client.request(options, (res) => {
          res.resume();
          resolve();
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('timeout'));
        });
        req.end();
      });
      
      console.log('✅ Target is reachable');
    } catch {
      console.log('⚠️  Target not reachable - continuing anyway');
      console.log('💡 Make sure Drizzle Studio is running: drizzle-kit studio');
    }

    startProxy(config);
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
