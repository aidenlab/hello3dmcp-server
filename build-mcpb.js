import fs from 'fs';
import archiver from 'archiver';

const output = fs.createWriteStream('hello3dmcp-server.mcpb');
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`✅ Package created: hello3dmcp-server.mcpb (${archive.pointer()} bytes)`);
});

archive.on('error', err => { throw err; });

archive.pipe(output);
archive.file('manifest.json', { name: 'manifest.json' });
archive.directory('dist/', 'dist');
archive.finalize();

