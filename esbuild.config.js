import { build } from 'esbuild';
import { writeFileSync, readFileSync } from 'fs';

// List of Node.js built-in modules that should not be bundled
const nodeBuiltins = [
  'fs', 'path', 'crypto', 'http', 'https', 'url', 'util', 'stream',
  'events', 'buffer', 'querystring', 'os', 'net', 'tls', 'zlib',
  'child_process', 'cluster', 'dgram', 'dns', 'readline', 'repl',
  'string_decoder', 'tty', 'vm', 'worker_threads', 'async_hooks',
  'assert', 'console', 'module', 'process', 'punycode', 'sys', 'timers'
];

build({
  entryPoints: ['server.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/hello3dmcp-server.js',
  external: nodeBuiltins, // Don't bundle Node.js built-ins, but DO bundle express
  minify: false, // Keep readable for debugging
  sourcemap: false,
}).then(() => {
  // Fix the __require function to handle Node.js built-ins
  // This is necessary because express dependencies use dynamic requires
  let code = readFileSync('dist/hello3dmcp-server.js', 'utf-8');
  
  // Add require polyfill for Node.js built-ins
  const requireFix = `
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const nodeBuiltins = new Set([${nodeBuiltins.map(b => `'${b}'`).join(', ')}]);
`;
  
  // Check if polyfill already exists (avoid duplicates)
  if (!code.includes('const _require = createRequire')) {
    code = requireFix + code;
  }
  
  // Replace esbuild's __require function to handle Node.js built-ins
  // esbuild creates a wrapper that throws errors for dynamic requires
  // We replace it to check for built-ins first and use createRequire
  const lines = code.split('\n');
  let found = false;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('var __require') && lines[i].includes('@__PURE__')) {
      // Find the end of the __require function definition
      let j = i;
      let braceCount = 0;
      let parenCount = 0;
      let foundFunctionCall = false;
      
      // Count opening parens and braces from the start line
      for (let char of lines[i]) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      
      // Continue until we find the closing of the function call
      while (j < lines.length && (parenCount > 0 || braceCount > 0 || !foundFunctionCall)) {
        j++;
        if (j >= lines.length) break;
        
        const line = lines[j];
        for (let char of line) {
          if (char === '(') parenCount++;
          if (char === ')') parenCount--;
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }
        
        // Check if we've closed the function call
        if (line.includes('});') && parenCount === 0 && braceCount === 0) {
          foundFunctionCall = true;
          break;
        }
      }
      
      if (foundFunctionCall) {
        // Replace with our fixed version that handles Node.js built-ins
        // Handle both "events" and "node:events" formats
        const replacement = `var __require = /* @__PURE__ */ (function(x) {
  // Handle Node.js built-ins with or without "node:" prefix
  const moduleName = x.startsWith('node:') ? x.slice(5) : x;
  if (nodeBuiltins.has(moduleName)) {
    return _require(x);
  }
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});`;
        lines.splice(i, j - i + 1, replacement);
        code = lines.join('\n');
        found = true;
        console.log('✅ __require function patched to handle Node.js built-ins');
        break;
      }
    }
  }
  
  if (!found) {
    console.error('❌ Could not find __require function to patch');
    process.exit(1);
  }
  
  writeFileSync('dist/hello3dmcp-server.js', code);
  console.log('✅ Bundle created with express bundled (self-contained package)');
}).catch(() => process.exit(1));
