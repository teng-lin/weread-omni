#!/usr/bin/env node
// A tracked launch target for a local source installation. Build before activating it.
import { fileURLToPath } from "node:url";

const cli = new URL("../dist/cli.js", import.meta.url);
process.argv[1] = fileURLToPath(cli);
await import(cli.href);
