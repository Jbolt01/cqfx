import { Client } from "pg";
import { Builder } from "flatbuffers";
import { createServer } from "http";
import { ConfigSnapshot, Instrument, EtfComponent, OptionMeta, RiskLimit, } from "@ctc/sdk-ts";
async function withPg(url, fn) {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
        return await fn(c);
    }
    finally {
        await c.end();
    }
}
async function getConfigVersion(client) {
    const r = await client.query("select (value->>'version')::bigint as v from settings where key='configVersion'");
    if (r.rowCount && r.rows[0]?.v != null)
        return Number(r.rows[0].v);
    await client.query("insert into settings(key, value) values ($1, $2) on conflict (key) do nothing", ["configVersion", { version: 0 }]);
    return 0;
}
async function bumpConfigVersion(client, next) {
    await client.query("insert into settings(key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", ["configVersion", { version: next }]);
}
function buildSnapshot(version, instruments, etf, options, limits) {
    const b = new Builder(1024);
    // Instruments
    const instOffsets = instruments.map((row) => {
        const symbol = b.createString(row.symbol);
        const currency = b.createString(row.currency ?? "USD");
        Instrument.startInstrument(b);
        Instrument.addId(b, row.id >>> 0);
        Instrument.addSymbol(b, symbol);
        Instrument.addType(b, row.type);
        Instrument.addCurrency(b, currency);
        Instrument.addTickSizeNanos(b, row.tick_size_nanos >>> 0);
        Instrument.addTickSizeTicks(b, row.tick_size_ticks >>> 0);
        Instrument.addLotSizeLots(b, row.lot_size_lots >>> 0);
        Instrument.addMeta(b, BigInt(row.meta));
        return Instrument.endInstrument(b);
    });
    const instrumentsVec = ConfigSnapshot.createInstrumentsVector(b, instOffsets);
    // ETF components
    const etfOffsets = etf.map((row) => {
        EtfComponent.startEtfComponent(b);
        EtfComponent.addEtfInstrumentId(b, row.etf_instrument_id >>> 0);
        EtfComponent.addComponentInstrumentId(b, row.component_instrument_id >>> 0);
        EtfComponent.addWeightNum(b, row.weight_num | 0);
        EtfComponent.addWeightDen(b, row.weight_den | 0);
        return EtfComponent.endEtfComponent(b);
    });
    const etfVec = ConfigSnapshot.createEtfVector(b, etfOffsets);
    // Options meta
    const optOffsets = options.map((row) => {
        OptionMeta.startOptionMeta(b);
        OptionMeta.addInstrumentId(b, row.instrument_id >>> 0);
        OptionMeta.addUnderlyingInstrumentId(b, row.underlying_instrument_id >>> 0);
        OptionMeta.addStrikeTicks(b, row.strike_ticks | 0);
        OptionMeta.addRight(b, row.right | 0);
        // Convert date to epoch days (UTC)
        const epochDays = Math.floor(Date.parse(row.expiry) / 86400000);
        OptionMeta.addExpiryEpochDays(b, epochDays >>> 0);
        OptionMeta.addMultiplier(b, row.multiplier >>> 0);
        return OptionMeta.endOptionMeta(b);
    });
    const optionsVec = ConfigSnapshot.createOptionsVector(b, optOffsets);
    // Risk limits
    const limitOffsets = limits.map((row) => {
        RiskLimit.startRiskLimit(b);
        RiskLimit.addTeamId(b, row.team_id >>> 0);
        RiskLimit.addInstrumentId(b, row.instrument_id >>> 0);
        RiskLimit.addPosMinLots(b, BigInt(row.pos_min_lots));
        RiskLimit.addPosMaxLots(b, BigInt(row.pos_max_lots));
        RiskLimit.addNotionalMaxTicks(b, BigInt(row.notional_max_ticks));
        RiskLimit.addMaxOrdersPerSec(b, row.max_orders_per_sec >>> 0);
        return RiskLimit.endRiskLimit(b);
    });
    const limitsVec = ConfigSnapshot.createRiskLimitsVector(b, limitOffsets);
    const tsNanos = BigInt(Date.now()) * 1000000n;
    ConfigSnapshot.startConfigSnapshot(b);
    ConfigSnapshot.addVersion(b, version);
    ConfigSnapshot.addInstruments(b, instrumentsVec);
    ConfigSnapshot.addEtf(b, etfVec);
    ConfigSnapshot.addOptions(b, optionsVec);
    ConfigSnapshot.addRiskLimits(b, limitsVec);
    ConfigSnapshot.addTsNanos(b, tsNanos);
    const root = ConfigSnapshot.endConfigSnapshot(b);
    b.finish(root);
    return b.asUint8Array();
}
async function publishOnce() {
    const POSTGRES_URL = process.env.POSTGRES_URL ?? "";
    const ENGINE_CONTROL_URL = process.env.ENGINE_CONTROL_URL ?? "";
    if (!POSTGRES_URL)
        throw new Error("POSTGRES_URL not set");
    if (!ENGINE_CONTROL_URL)
        throw new Error("ENGINE_CONTROL_URL not set");
    await withPg(POSTGRES_URL, async (client) => {
        // Load rows
        const [inst, etf, opt, lim] = await Promise.all([
            client.query("select id, symbol, type, coalesce(currency,'USD') currency, tick_size_nanos, tick_size_ticks, lot_size_lots, meta from instruments order by id"),
            client.query("select etf_instrument_id, component_instrument_id, weight_num, weight_den from etf_components order by 1,2"),
            client.query("select instrument_id, underlying_instrument_id, strike_ticks, right, expiry, multiplier from options_meta order by instrument_id"),
            client.query("select team_id, instrument_id, pos_min_lots, pos_max_lots, notional_max_ticks, max_orders_per_sec from risk_limits order by 1,2"),
        ]);
        // Version bump
        const cur = await getConfigVersion(client);
        const next = cur + 1;
        const buf = buildSnapshot(BigInt(next), inst.rows, etf.rows, opt.rows, lim.rows);
        // Post to engine
        const res = await fetch(ENGINE_CONTROL_URL, {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: buf,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Engine responded ${res.status}: ${text}`);
        }
        await bumpConfigVersion(client, next);
        console.log(`Published ConfigSnapshot v${next} (${buf.byteLength} bytes)`);
    });
}
async function listen() {
    const PORT = Number(process.env.PORT ?? 7071);
    const server = createServer(async (req, res) => {
        try {
            if (req.method === "POST" && req.url === "/publish") {
                await publishOnce();
                res.writeHead(200).end("ok\n");
                return;
            }
            res.writeHead(404).end("not found\n");
        }
        catch (err) {
            res.writeHead(500).end(String(err?.message ?? err));
        }
    });
    server.listen(PORT, () => {
        console.log(`config-publisher listening on :${PORT}`);
    });
}
async function main() {
    const cmd = process.argv[2] ?? "listen";
    if (cmd === "publish") {
        await publishOnce();
        return;
    }
    await listen();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=index.js.map