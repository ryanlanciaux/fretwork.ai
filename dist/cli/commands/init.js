import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import pc from "picocolors";
import { bootstrapConfig, getConfig } from "../../store/index.js";
import { stageLogoFile } from "../../store/render/index.js";
import { emitJson, emitOk, fail } from "../output.js";
function num(v, fallback) {
    if (v === undefined)
        return fallback;
    const n = Number(v);
    if (!Number.isFinite(n))
        throw new Error(`Expected a number, got: ${v}`);
    return n;
}
export async function runInit(args) {
    // Snapshot any existing config so we can preserve fields the user doesn't override.
    const before = getConfig();
    const isFirstRun = before.businessName === "Your Business" && before.businessEmail === "you@example.com";
    const interactive = !args.yes && process.stdin.isTTY;
    const ask = async (prompt, fallback) => {
        if (!interactive)
            return fallback === null ? "" : String(fallback);
        const rl = createInterface({ input, output });
        try {
            const display = fallback === null || fallback === "" ? "" : pc.dim(` [${fallback}]`);
            const answer = (await rl.question(`${prompt}${display}: `)).trim();
            return answer || (fallback === null ? "" : String(fallback));
        }
        finally {
            rl.close();
        }
    };
    const businessName = args.name ?? (await ask("Business name", isFirstRun ? "" : before.businessName));
    if (!businessName)
        fail("Business name is required.");
    const businessEmail = args.email ?? (await ask("Business email", isFirstRun ? "" : before.businessEmail));
    if (!businessEmail)
        fail("Business email is required.");
    const businessAddress = args.address ?? (await ask("Address (optional)", before.businessAddress ?? ""));
    const businessCity = args.city ?? (await ask("City (optional)", before.businessCity ?? ""));
    const businessPhone = args.phone ?? (await ask("Phone (optional)", before.businessPhone ?? ""));
    const businessLogo = args.logo ?? (await ask("Logo image path (optional; copied into ~/.fretwork)", before.businessLogo ?? ""));
    const paymentTerms = args.paymentTerms ?? (await ask("Payment instructions printed on invoices, e.g. bank details (optional)", before.paymentTerms ?? ""));
    const defaultRate = num(args.rate ?? (await ask("Default hourly rate", before.defaultRate)), before.defaultRate);
    const currency = args.currency ?? (await ask("Currency", before.currency));
    const taxRate = num(args.taxRate ?? (await ask("Tax rate added to invoices (%)", before.taxRate)), before.taxRate);
    const dueDays = Math.max(0, Math.floor(num(args.dueDays ?? (await ask("Payment terms: days until an invoice is due (e.g. 14 or 30)", before.dueDays)), before.dueDays)));
    const cfg = bootstrapConfig({
        businessName,
        businessEmail,
        businessAddress: businessAddress || null,
        businessCity: businessCity || null,
        businessPhone: businessPhone || null,
        businessLogo: businessLogo ? stageLogoFile(businessLogo) : null,
        paymentTerms: paymentTerms || null,
        defaultRate,
        currency,
        taxRate,
        dueDays,
    });
    if (args.json) {
        emitJson(cfg);
    }
    else {
        emitOk(`Saved config for ${pc.bold(cfg.businessName)} (${cfg.currency}, ${cfg.dueDays}-day terms).`);
    }
    return 0;
}
