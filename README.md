# Daytona Drizzle Proxy

A simple CORS proxy for Drizzle Studio in Daytona environments.

## Installation

```bash
# npm
npm install -g daytona-drizzle-proxy

# bun
bun install -g daytona-drizzle-proxy
```

## Usage

1. Start Drizzle Studio:
   ```bash
   drizzle-kit studio
   ```

2. Start the proxy:
   ```bash
   daytona-drizzle-proxy
   ```

3. Use proxy URL: `http://localhost:8080`

## Options

- `-p, --port <number>`: Proxy port (default: 8080)
- `-t, --target <url>`: Target URL (default: http://localhost:4983)
- `-h, --help`: Show help

## License

MIT
