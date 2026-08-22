import { getConfig, updateConfig } from "../../store/index.js";
import { stageLogoFile } from "../../store/render/index.js";
import { emitJson, emitOk, fail, tryRun } from "../output.js";
export function runConfigShow(opts) {
    const c = getConfig();
    if (opts.json)
        return emitJson(c);
    process.stdout.write(JSON.stringify(c, null, 2) + "\n");
}
export function runConfigSet(opts) {
    const numberOpt = (v) => {
        if (v === undefined)
            return undefined;
        const n = Number(v);
        if (!Number.isFinite(n))
            fail(`Expected a number, got: ${v}`);
        return n;
    };
    const cfg = tryRun(() => updateConfig({
        businessName: opts.name,
        businessEmail: opts.email,
        businessAddress: opts.address === undefined ? undefined : opts.address || null,
        businessCity: opts.city === undefined ? undefined : opts.city || null,
        businessPhone: opts.phone === undefined ? undefined : opts.phone || null,
        businessLogo: opts.logo === undefined ? undefined : opts.logo ? stageLogoFile(opts.logo) : null,
        businessTagline: opts.tagline === undefined ? undefined : opts.tagline || null,
        businessSite: opts.site === undefined ? undefined : opts.site || null,
        accentColor: opts.accentColor === undefined ? undefined : opts.accentColor || null,
        customInstructions: opts.customInstructions === undefined
            ? undefined
            : opts.customInstructions || null,
        defaultRate: numberOpt(opts.rate),
        taxRate: numberOpt(opts.taxRate),
        currency: opts.currency,
        dueDays: opts.dueDays === undefined ? undefined : Math.max(0, Math.floor(Number(opts.dueDays))),
        paymentTerms: opts.paymentTerms === undefined ? undefined : opts.paymentTerms || null,
        invoiceTemplate: opts.invoiceTemplate === undefined ? undefined : opts.invoiceTemplate || null,
    }), opts.json);
    if (opts.json)
        return emitJson(cfg);
    emitOk("Updated config");
}
