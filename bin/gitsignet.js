#!/usr/bin/env node
import { doctor, check, fix, install, uninstall, init } from '../lib/commands.js';

const VERSION = '0.1.3';

const HELP = `gitsignet — git identity guard

Usage:
  gitsignet doctor              Diagnose the identity for this repo and remote
  gitsignet check [--hook]      Guard: exit non-zero if the identity is wrong
  gitsignet fix [--global]      Set git config to the identity this remote expects
  gitsignet install             Install the pre-commit guard in this repo
  gitsignet uninstall           Remove the pre-commit guard from this repo
  gitsignet init [--global]     Write a sample config (.gitsignet.json)

Options:
  -h, --help                    Show this help
  -v, --version                 Show version

Config is a .gitsignet.json in the repo, or a global config at
$XDG_CONFIG_HOME/gitsignet/config.json. Rules are keyed off the repo's
remote (host/owner), so the right identity is enforced no matter where
the repo is cloned. See https://gitsignet.dev`;

function main(argv) {
  const args = argv.slice(2);
  const cmd = args[0];
  const flags = new Set(args.slice(1));

  if (args.includes('-h') || args.includes('--help') || !cmd) {
    console.log(HELP);
    return cmd ? 0 : 0;
  }
  if (args.includes('-v') || args.includes('--version')) {
    console.log(VERSION);
    return 0;
  }

  switch (cmd) {
    case 'doctor':
      return doctor();
    case 'check':
      return check({ hook: flags.has('--hook') });
    case 'fix':
      return fix({ global: flags.has('--global') });
    case 'install':
      return install();
    case 'uninstall':
      return uninstall();
    case 'init':
      return init({ global: flags.has('--global') });
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      return 2;
  }
}

process.exit(main(process.argv));
