/**
 * Single-instance Lucid Evolution façade.
 *
 * The pipeline shares one PHYSICAL copy of `@lucid-evolution/lucid` with
 * `@cdt/txlib` (imported by source, so its bare `@lucid-evolution/lucid`
 * imports resolve to `offchain/cdt-txlib/node_modules`). That matters because
 * lucid keeps mutable module state: `Lucid(emulator, "Custom")` writes the
 * emulator's slot config into the module-global `SLOT_CONFIG_NETWORK`, which
 * the txlib builders read back through `unixTimeToSlot`/`slotToUnixTime` when
 * they align validity bounds. Two copies of the module would leave txlib
 * with a zeroed Custom slot config and broken bound math.
 *
 * Everything in this package therefore imports lucid from here, never from
 * the bare specifier.
 */
export * from "../../cdt-txlib/node_modules/@lucid-evolution/lucid/dist/index.js";
