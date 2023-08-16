#!/usr/bin/env node

// FALSE -> LLVM IR Compiler
// Requirements:
//  - Node.js
//  - Typescript Compiler
//  - LLC or equivalent (something to compile LLVM IR)

import { readFile, writeFile } from "fs/promises";
import { compile } from "./compiler.js";
import { parse } from "./parser.js";

async function main() {
	const filename = process.argv[2];
	if (!filename) {
		console.error('Filename required');
		process.exit(1);
	}

	const source = await readFile(filename, 'utf-8');
	const outFile = process.argv[3] ?? filename.replace(/\..+$/, '.ll');

	const ast = parse(source);
	console.info('Parsed AST');
	const IR = compile(ast);
	await writeFile(outFile, IR);
	console.info('Compiled to ' + outFile)
}

await main();