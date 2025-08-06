#!/usr/bin/env node

import http from 'http';

const VERSION = '1.1.3';

function showHelp() {
  console.log(`
Daytona Drizzle Proxy v${VERSION}

Simple CORS proxy for Drizzle Studio in Daytona environments.

USAGE:
  daytona-drizzle-proxy [OPTIONS]

OPTIONS:
  -p, --port <number>     Proxy server port (default: 8080)
  -t, --target <url>      Target Drizzle Studio URL (default: http://localhost:1434)
  -h, --help             Show this help
  --version              Show version

EXAMPLES:
  daytona-drizzle-proxy
    Start proxy on port 8080, forwarding to localhost:1434

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
    target: 'http://localhost:1434'
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
    const fullTargetUrl = url.toString();

    // Get request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    // Make request to target
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (key !== 'host' && key !== 'origin' && value) {
        headers[key] = Array.isArray(value) ? value[0] : value;
      }
    }

    const response = await fetch(fullTargetUrl, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' && body.length > 0 ? body : undefined,
    });

    // Add CORS headers
    addCorsHeaders(res, req.headers.origin);

    // Copy response headers (except CORS ones)
    response.headers.forEach((value: string, key: string) => {
      if (!key.toLowerCase().startsWith('access-control-')) {
        res.setHeader(key, value);
      }
    });

    // Send response
    res.writeHead(response.status, response.statusText);
    
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
    }
    
    res.end();

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
      await fetch(config.target, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
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
