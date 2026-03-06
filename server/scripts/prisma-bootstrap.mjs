import { spawnSync } from 'child_process';

const runCommand = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
};

export const runPrismaBootstrap = (cwd) => {
  if (process.env.PRISMA_AUTO_BOOTSTRAP === '0') {
    return;
  }
  runCommand('npx', ['prisma', 'generate'], cwd);
  runCommand('npx', ['prisma', 'migrate', 'deploy'], cwd);
};
