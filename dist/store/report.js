import { listInvoices } from "./invoices.js";
import { round2 } from "./util.js";
export function financialReport(opts = {}) {
    const all = listInvoices();
    const within = all.filter((i) => {
        if (opts.from && i.issuedAt < opts.from)
            return false;
        if (opts.to && i.issuedAt > opts.to)
            return false;
        return true;
    });
    const totals = {
        draft: 0,
        sent: 0,
        paid: 0,
        overdue: 0,
        void: 0,
    };
    const byClient = new Map();
    let outstanding = 0;
    let collected = 0;
    for (const inv of within) {
        totals[inv.status] = round2(totals[inv.status] + inv.total);
        collected = round2(collected + inv.amountPaid);
        const cur = byClient.get(inv.clientSlug) ?? { revenue: 0, outstanding: 0 };
        if (inv.status === "paid")
            cur.revenue = round2(cur.revenue + inv.total);
        if (inv.status === "sent" || inv.status === "overdue") {
            // Partial payments shrink what's still owed.
            cur.outstanding = round2(cur.outstanding + inv.balanceDue);
            outstanding = round2(outstanding + inv.balanceDue);
        }
        byClient.set(inv.clientSlug, cur);
    }
    return {
        range: { from: opts.from ?? null, to: opts.to ?? null },
        totals,
        outstanding,
        paid: totals.paid,
        collected,
        byClient: [...byClient.entries()]
            .map(([client, v]) => ({ client, ...v }))
            .sort((a, b) => b.revenue + b.outstanding - (a.revenue + a.outstanding)),
    };
}
