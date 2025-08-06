#!/usr/bin/env node

import http from 'http';
import https from 'https';
import { URL } from 'url';

const VERSION = '1.1.5';

function showHelp() {
  console.log(`
Daytona Drizzle Proxy v${VERSION}

Simple CORS proxy for Drizzle Studio in Daytona environments.

USAGE:
  daytona-drizzle-proxy [OPTIONS]

OPTIONS:
  -p, --port <number>     Proxy server port (default: 8080)
  -t, --target <url>      Target Drizzle Studio URL (default: http://localhost:4983)
  -h, --help             Show this help
  --version              Show version

EXAMPLES:
  daytona-drizzle-proxy
    Start proxy on port 8080, forwarding to localhost:4983

  daytona-drizzle-proxy --port 9000 --target http://localhost:4983
    Start proxy on port 9000, forwarding to localhost:4983

USAGE:
  1. Start Drizzle Studio: drizzle-kit studio
  2. Start this proxy: daytona-drizzle-proxy  
  3. Use proxy URL: http://localhost:8080
`);
}

interface Config {
  port: number;
  target: string;
}

function parseArgs(args: string[]): Config {
  const config: Config = {
    port: 8080,
    target: 'http://localhost:4983'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '-h':
      case '--help':
        showHelp();
        process.exit(0);
        break;
      case '--version':
        console.log(`daytona-drizzle-proxy v${VERSION}`);
        process.exit(0);
        break;
      case '-p':
      case '--port':
        const port = parseInt(args[++i]);
        if (isNaN(port) || port <= 0 || port > 65535) {
          console.error(`❌ Invalid port: ${args[i]}`);
          process.exit(1);
        }
        config.port = port;
        break;
      case '-t':
      case '--target':
        config.target = args[++i];
        if (!config.target) {
          console.error('❌ Target URL required');
          process.exit(1);
        }
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`❌ Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }
  
  return config;
}

function addCorsHeaders(res: http.ServerResponse, origin?: string) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('X-Daytona-Disable-CORS', 'true');
}

async function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse, targetUrl: string) {
  try {
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
    
    // Use the appropriate module based on protocol
    const client = url.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: req.method || 'GET',
      headers: headers
    };

    // Make the proxy request
    const proxyReq = client.request(options, (proxyRes) => {
      // Add CORS headers
      addCorsHeaders(res, req.headers.origin);
      
      // Copy response headers (except CORS ones)
      Object.entries(proxyRes.headers).forEach(([key, value]) => {
        if (!key.toLowerCase().startsWith('access-control-') && value) {
          res.setHeader(key, value);
        }
      });
      
      // Set status code
      res.writeHead(proxyRes.statusCode || 200, proxyRes.statusMessage);
      
      // Pipe the response
      proxyRes.pipe(res);
    });

    // Handle errors
    proxyReq.on('error', (error) => {
      throw error;
    });

    // Write request body if present
    if (body.length > 0 && req.method !== 'GET' && req.method !== 'HEAD') {
      proxyReq.write(body);
    }
    
    proxyReq.end();

  } catch (error) {
    const errorDetails = error instanceof Error 
      ? { 
          message: error.message, 
          code: (error as any).code,
          cause: (error as any).cause,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      : { message: 'Unknown error' };
    
    console.error('❌ Proxy error:', {
      url: req.url,
      method: req.method,
      target: targetUrl,
      error: errorDetails
    });
    
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
  try {
    const config = parseArgs(process.argv.slice(2));
    
    // Quick connectivity check
    console.log(`🔍 Testing connection to ${config.target}...`);
    try {
      const testUrl = new URL(config.target);
      const client = testUrl.protocol === 'https:' ? https : http;
      
      await new Promise<void>((resolve, reject) => {
        const req = client.request({
          hostname: testUrl.hostname,
          port: testUrl.port || (testUrl.protocol === 'https:' ? 443 : 80),
          path: '/',
          method: 'HEAD',
          timeout: 3000
        }, (res) => {
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
