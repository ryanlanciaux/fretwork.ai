import { financialReport } from "../../store/index.js";
import { emitJson, emitTable, tryRun } from "../output.js";

interface FinancialOpts { from?: string; to?: string; json?: boolean }

export function runReportFinancial(opts: FinancialOpts): void {
  const r = tryRun(() => financialReport({ from: opts.from, to: opts.to }), opts.json);
  if (opts.json) return emitJson(r);
  process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  process.stdout.write("\n");
  emitTable(
    r.byClient.map((b) => ({
      client: b.client,
      revenue: b.revenue.toFixed(2),
      outstanding: b.outstanding.toFixed(2),
    })),
    ["client", "revenue", "outstanding"],
  );
}
