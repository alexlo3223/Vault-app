// Builds Vault.exe in the project root: a copy of this Node with app/launcher.cjs injected (Node SEA).
// The exe needs the app/ and notes/ folders next to it.
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (f) => join(root, f);
const exe = at(process.platform === 'win32' ? 'Vault.exe' : 'vault');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

// Windows PE: the file header points at the PE signature (e_lfanew, offset 0x3C). The optional header
// starts 24 bytes later and its Subsystem field sits 68 bytes into it: 3 = console, 2 = GUI (no console window).
function setGuiSubsystem(file) {
  const buf = readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a PE file');
  const subsystem = pe + 24 + 68;
  if (buf.readUInt16LE(subsystem) !== 3) throw new Error('unexpected subsystem value');
  buf.writeUInt16LE(2, subsystem);
  writeFileSync(file, buf);
}

writeFileSync(at('sea-config.json'), JSON.stringify({ main: 'app/launcher.cjs', output: 'sea-prep.blob', disableExperimentalSEAWarning: true }));
run(`"${process.execPath}"`, ['--experimental-sea-config', 'sea-config.json']);
copyFileSync(process.execPath, exe);
run('npx', ['--yes', 'postject@1.0.0-alpha.6', `"${exe}"`, 'NODE_SEA_BLOB', 'sea-prep.blob', '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);
rmSync(at('sea-config.json'));
rmSync(at('sea-prep.blob'));
if (process.platform === 'win32') setGuiSubsystem(exe);
console.log(`built ${exe}`);
