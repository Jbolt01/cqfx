#!/usr/bin/env -S node --enable-source-maps
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = resolve(join(__dirname, "../../.."));
const schemaPath = resolve(join(root, "packages/protocol/fbs/envelope.fbs"));
const abiSnapshotPath = resolve(
	join(root, "packages/protocol/abi/envelope.abi.json"),
);

function ensureDir(p: string) {
	if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function cleanDir(p: string) {
	if (existsSync(p)) rmSync(p, { recursive: true, force: true });
	mkdirSync(p, { recursive: true });
}

type EnumEntry = { name: string; value: number };
type ABISnapshot = {
	version: 1;
	enums: Record<string, EnumEntry[]>;
	tables: Record<string, string[]>;
	unions: Record<string, string[]>;
};

function parseFbsToABI(fbs: string): ABISnapshot {
	const enums: Record<string, EnumEntry[]> = {};
	const tables: Record<string, string[]> = {};
	const unions: Record<string, string[]> = {};

	// enums with explicit values
	const enumRe = /enum\s+(\w+)\s*:\s*\w+\s*\{([^}]*)\}/gms;
	for (const m of fbs.matchAll(enumRe)) {
		const name = m[1];
		const body = m[2];
		const entries: EnumEntry[] = [];
		for (const raw of body.split(",")) {
			const t = raw.trim();
			if (!t) continue;
			const parts = t.split("=").map((s) => s.trim());
			if (parts.length !== 2) continue;
			const [n, v] = parts;
			const num = Number(v);
			if (!Number.isFinite(num)) continue;
			entries.push({ name: n, value: num });
		}
		enums[name] = entries;
	}

	// tables with ordered fields
	const tableRe = /table\s+(\w+)\s*\{([^}]*)\}/gms;
	for (const m of fbs.matchAll(tableRe)) {
		const name = m[1];
		const body = m[2];
		const fields: string[] = [];
		for (const raw of body.split(";")) {
			const line = raw.trim();
			if (!line) continue;
			// field format: name:type ...
			const nameMatch = line.match(/^(\w+)\s*:/);
			if (nameMatch) fields.push(nameMatch[1]);
		}
		tables[name] = fields;
	}

	// unions with ordered types
	const unionRe = /union\s+(\w+)\s*\{([^}]*)\}/gms;
	for (const m of fbs.matchAll(unionRe)) {
		const name = m[1];
		const body = m[2];
		const items = body
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		unions[name] = items;
	}

	return { version: 1, enums, tables, unions };
}

function checkCompatibility(prev: ABISnapshot, next: ABISnapshot) {
	const problems: string[] = [];
	// Enums: cannot change values; can append at end only
	for (const [ename, eprev] of Object.entries(prev.enums)) {
		const enext = next.enums[ename];
		if (!enext) {
			problems.push(`Enum removed: ${ename}`);
			continue;
		}
		for (let i = 0; i < eprev.length; i++) {
			const a = eprev[i];
			const b = enext[i];
			if (!b || a.name !== b.name || a.value !== b.value) {
				problems.push(
					`Enum ${ename} changed at index ${i}: ${a.name}=${a.value} → ${b?.name}=${b?.value}`,
				);
			}
		}
	}
	// Tables: cannot remove or reorder fields; can append only
	for (const [tname, fprev] of Object.entries(prev.tables)) {
		const fnext = next.tables[tname];
		if (!fnext) {
			problems.push(`Table removed: ${tname}`);
			continue;
		}
		for (let i = 0; i < fprev.length; i++) {
			const a = fprev[i];
			const b = fnext[i];
			if (!b || a !== b) {
				problems.push(
					`Table ${tname} field changed at index ${i}: ${a} → ${b}`,
				);
			}
		}
	}
	// Unions: cannot reorder; can append only
	for (const [uname, uprev] of Object.entries(prev.unions)) {
		const unext = next.unions[uname];
		if (!unext) {
			problems.push(`Union removed: ${uname}`);
			continue;
		}
		for (let i = 0; i < uprev.length; i++) {
			const a = uprev[i];
			const b = unext[i];
			if (!b || a !== b) {
				problems.push(
					`Union ${uname} entry changed at index ${i}: ${a} → ${b}`,
				);
			}
		}
	}

	if (problems.length) {
		const msg = problems.map((p) => ` - ${p}`).join("\n");
		throw new Error(`Schema compatibility check failed:\n${msg}`);
	}
}

function runFlatc(args: string[]) {
	const flatcBin = resolve(join(root, "node_modules/.bin/flatc"));
	const bin = existsSync(flatcBin) ? flatcBin : "flatc";
	const res = spawnSync(bin, args, { stdio: "inherit" });
	if (res.error) throw res.error;
	if (typeof res.status === "number" && res.status !== 0) {
		throw new Error(`flatc exited with code ${res.status}`);
	}
}

function main() {
	const checkOnly = process.argv.includes("--check");
	const abiOnly = process.argv.includes("--abi-only");
	const fbs = readFileSync(schemaPath, "utf8");
	const abiNext = parseFbsToABI(fbs);
	ensureDir(dirname(abiSnapshotPath));
	if (existsSync(abiSnapshotPath)) {
		const abiPrev = JSON.parse(
			readFileSync(abiSnapshotPath, "utf8"),
		) as ABISnapshot;
		checkCompatibility(abiPrev, abiNext);
	}
	if (checkOnly) {
		console.log("Schema compatibility OK");
		return;
	}
	// Write/Update ABI snapshot
	writeFileSync(abiSnapshotPath, `${JSON.stringify(abiNext, null, 2)}\n`);

	if (abiOnly) {
		console.log("ABI snapshot updated (codegen skipped by --abi-only)");
		return;
	}

	// Prepare output dirs
	const tsOut = resolve(join(root, "packages/sdk-ts/src/gen"));
	const pyOut = resolve(join(root, "packages/sdk-py/ctc_protocol/gen"));
	const javaOut = resolve(join(root, "packages/sdk-java/src/main/java"));
	const cppOut = resolve(join(root, "packages/sdk-cpp/include"));
	cleanDir(tsOut);
	cleanDir(pyOut);
	cleanDir(javaOut);
	cleanDir(cppOut);

	// Generate
	runFlatc(["--ts", "--gen-object-api", "-o", tsOut, schemaPath]);
	runFlatc(["--python", "-o", pyOut, schemaPath]);
	runFlatc(["--java", "-o", javaOut, schemaPath]);
	runFlatc(["--cpp", "-o", cppOut, schemaPath]);

	console.log("Protocol codegen complete.");
}

main();
