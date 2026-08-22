import * as fs from "node:fs";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { bundledTemplatePath, readBundledTemplate, readUserTemplate, userTemplatePath, writeUserTemplate, } from "../../store/render/index.js";
import { emitJson, emitOk, fail } from "../output.js";
// Restore the user's invoice template to the bundled default. Prompts via
// stderr unless --force; in non-TTY contexts (CI / piped) we refuse rather
// than silently clobber edits.
export function runTemplateReset(opts) {
    const dst = userTemplatePath();
    const src = bundledTemplatePath();
    if (!existsSync(src)) {
        fail(`Bundled template not found at ${src}. Reinstall fretwork.`);
    }
    if (existsSync(dst) && !opts.force) {
        if (!process.stdin.isTTY || !process.stderr.isTTY) {
            fail(`${dst} already exists. Pass --force to overwrite, or delete it first.`);
        }
        process.stderr.write(`This will overwrite ${dst} with the bundled default.\nType "yes" to continue: `);
        const answer = readLineSync();
        if (answer !== "yes") {
            fail("Cancelled.");
        }
    }
    mkdirSync(dirname(dst), { recursive: true, mode: 0o700 });
    copyFileSync(src, dst);
    if (opts.json)
        return emitJson({ ok: true, path: dst });
    emitOk(`Restored default template at ${dst}`);
}
export function runTemplatePath(opts) {
    const p = userTemplatePath();
    const exists = existsSync(p);
    if (opts.json)
        return emitJson({ path: p, exists });
    process.stdout.write(p + "\n");
    if (!exists) {
        process.stderr.write(`(no user copy yet — run \`fretwork template reset\` to seed it)\n`);
    }
}
export function runTemplateShowDefault() {
    process.stdout.write(readBundledTemplate());
}
// Emit the current user template to stdout. When the user copy doesn't
// exist yet (typical right after install or after `template reset` was
// skipped), we fall back to the bundled default so the LLM still gets
// a working baseline to modify. The hint goes to stderr so the stdout
// stream stays consumable by a pipeline ( e.g. `fretwork template print
// | sed ... | fretwork template write`).
export function runTemplatePrint(opts) {
    const { html, fromUserCopy } = readUserTemplate();
    if (opts.json) {
        return emitJson({ html, fromUserCopy, path: userTemplatePath() });
    }
    process.stdout.write(html);
    if (!fromUserCopy) {
        process.stderr.write(`(no user copy at ${userTemplatePath()} yet — printed the bundled default. Run \`fretwork template reset\` to seed.)\n`);
    }
}
// Read HTML from stdin, validate it (Mustache.parse + smoke render with
// stub context), atomically replace ~/.fretwork/templates/invoice.html.
// Refuses to persist anything that fails validation — the on-disk
// template is always the last *known-good* version. Returns the path +
// byte count so callers can confirm the write landed.
export function runTemplateWrite(opts) {
    const html = readAllStdin();
    if (!html.trim()) {
        fail("No HTML on stdin. Pipe the new template, e.g.: cat invoice.html | fretwork template write");
    }
    let result;
    try {
        result = writeUserTemplate(html);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (opts.json) {
            process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
            process.exit(1);
        }
        fail(`Template validation failed (existing template kept):\n  ${msg}`);
    }
    if (opts.json)
        return emitJson({ ok: true, ...result });
    emitOk(`Wrote ${result.sizeBytes} bytes to ${result.path}`);
}
function readAllStdin() {
    const chunks = [];
    const buf = Buffer.alloc(64 * 1024);
    for (;;) {
        let n;
        try {
            n = fs.readSync(0, buf, 0, buf.length, null);
        }
        catch (e) {
            // EAGAIN on a non-TTY stdin can race with the buffer fill; retry
            // once, then bail. In practice this shouldn't trip on piped input.
            const code = e.code;
            if (code === "EAGAIN")
                continue;
            throw e;
        }
        if (n === 0)
            break;
        chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks).toString("utf-8");
}
// Read a single line of stdin synchronously. Block on it because clack is
// overkill for a one-shot "yes/no" prompt and adding the dep here would
// pull in another runtime external for the bundled CLI.
function readLineSync() {
    const buf = Buffer.alloc(1024);
    let out = "";
    for (;;) {
        let n;
        try {
            n = fs.readSync(0, buf, 0, buf.length, null);
        }
        catch {
            return out.trim();
        }
        if (n === 0)
            break;
        const chunk = buf.toString("utf-8", 0, n);
        const nl = chunk.indexOf("\n");
        if (nl !== -1) {
            out += chunk.slice(0, nl);
            break;
        }
        out += chunk;
    }
    return out.trim();
}
