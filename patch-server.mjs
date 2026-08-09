// Post-build patch: TanStack Start v1.158 server-fn transport (REQUEST side).
//
// The shipped client bundle seroval-encodes request bodies with toJSON, which
// produces the ENVELOPE format {t:<node>, f:<features>, m:<marked>}. The server's
// parsePayload originally called fromJSON directly, which cannot read the
// cross-graph form it was given in this version pairing — fromJSON threw, the
// handler saw data=undefined and crashed with "input.email" — returning a 200
// seroval error that left the client promise pending forever (button stuck on
// "Creating account…").
//
// Fix: parsePayload now (1) tries fromJSON, (2) on failure manually decodes the
// seroval cross graph with a FULL recursive walker (__svDecode) over the ENTIRE
// payload tree — arrays, seroval nodes (t:0 envelope → m, t:1 strings, t:2
// primitives, t:10 k/v objects), and ANY other object (e.g. the real client
// body wrapper {data: <envelope>, method: "POST"}) by walking its own
// properties, decoding each value and preserving keys. A seen-set guards
// against circular payloads. Plain-JSON bodies pass through unchanged
// (__svDecode rebuilds them key-for-key with identical values).
//
// RESPONSE side: NOT patched, on purpose. Verified against seroval 1.5.4 (the
// version this build ships): the server emits responses with
// toCrossJSONStream (the cross format {t,i,p}), and the shipped client decodes
// them with fromCrossJSON (bp in the client bundle is deserializeTop over a
// cross context) — a matching pair. The two formats are asymmetric in seroval
// 1.5.x (envelope <-> fromJSON, cross <-> fromCrossJSON), but each side of this
// transport already uses its matching decoder, so responses round-trip fine.
// An earlier attempt to make the server emit the envelope instead BROKE the
// client decode (fromCrossJSON throws "Seroval Error (step: 3)" on an
// envelope) and re-introduced the hang — do not "fix" the response format.
import { readFileSync, writeFileSync } from 'node:fs';
const f = new URL('./dist/server/server.js', import.meta.url);
let s = readFileSync(f, 'utf8');

const decoder = `
function __svDecode(n, seen) {
  if (n === null || n === undefined) return n;
  if (typeof n !== 'object') return n;
  if (Array.isArray(n)) {
    const out = [];
    for (let i = 0; i < n.length; i++) out.push(__svDecode(n[i], seen));
    return out;
  }
  if (!seen) seen = new Set();
  if (seen.has(n)) return n;
  seen.add(n);
  try {
    if (typeof n.t === 'number') {
      const t = n.t;
      // seroval toJSON request envelope: {t:0, f:<features>, m:<marked payload>}.
      // Decode its marked content before handling ordinary cross-graph nodes.
      if (t === 0 && Object.prototype.hasOwnProperty.call(n, 'm')) return __svDecode(n.m, seen);
      if (t === 0) return null;
      if (t === 1) return n.s;
      if (t === 2) {
        const v = n.s;
        if (v === 2) return true;
        if (v === 1) return false;
        if (v === 0) return null;
        return v;
      }
      if (t === 10) {
        const k = n.p?.k || [];
        const v = n.p?.v || [];
        const omitted = Array.isArray(n.o) ? new Set(n.o) : null;
        const entries = [];
        for (let i = 0; i < k.length; i++) {
          if (omitted && omitted.has(i)) continue;
          entries.push([k[i], __svDecode(v[i], seen)]);
        }
        return Object.fromEntries(entries);
      }
      return n;
    }
    // Any other object (e.g. the real body wrapper {data: <envelope>, method:
    // "POST"}): decode each property value, preserving the key.
    const entries = [];
    for (const key of Object.keys(n)) entries.push([key, __svDecode(n[key], seen)]);
    return Object.fromEntries(entries);
  } finally {
    seen.delete(n);
  }
}
function parsePayload(payload) {
  try { return fromJSON(payload, { plugins: serovalPlugins }); } catch (e) {}
  return __svDecode(payload);
}`;

// The previous (v1) decoder as it currently sits in dist — replaced in place so
// already-patched builds upgrade rather than erroring on the pattern lookup.
const oldDecoder = `
function __svDecode(n) {
  if (n === null || n === undefined) return n;
  if (typeof n !== 'object') return n;
  if (Array.isArray(n)) return n.map(__svDecode);
  if (typeof n.t !== 'number') return n;
  const t = n.t;
  // seroval toJSON request envelope: {t:0, f:<features>, m:<marked payload>}.
  // Decode its marked content before handling ordinary cross-graph nodes.
  if (t === 0 && Object.prototype.hasOwnProperty.call(n, 'm')) return __svDecode(n.m);
  if (t === 0) return null;
  if (t === 1) return n.s;
  if (t === 2) {
    const v = n.s;
    if (v === 2) return true;
    if (v === 1) return false;
    if (v === 0) return null;
    return v;
  }
  if (t === 10) {
    const k = n.p?.k || [];
    const v = n.p?.v || [];
    const omitted = Array.isArray(n.o) ? new Set(n.o) : null;
    const out = {};
    for (let i = 0; i < k.length; i++) {
      if (omitted && omitted.has(i)) continue;
      out[k[i]] = __svDecode(v[i]);
    }
    return out;
  }
  return n;
}
function parsePayload(payload) {
  try { return fromJSON(payload, { plugins: serovalPlugins }); } catch (e) {}
  if (payload && typeof payload === 'object' && typeof payload.t === 'number') {
    const decoded = __svDecode(payload);
    if (decoded && typeof decoded === 'object') return decoded;
  }
  return payload;
}`;

// Responses are deliberately forced to the non-stream cross-JSON path. The
// framed/RawStream path can leave serverFnFetcher waiting for a terminal frame
// for ordinary object results; these server functions never return raw streams.
const responsePatch = /let serializeResult = function\(res2\) \{\s*let nonStreamingBody = void 0;/;
const responseReplacement = `let serializeResult = async function(res2) {
        if (res2 !== void 0) {
          const body = JSON.stringify(await toCrossJSONAsync(res2, { refs: new Map(), plugins: serovalPlugins }));
          const responseMeta = getResponse();
          return new Response(body, { status: responseMeta.status, statusText: responseMeta.statusText, headers: { 'Content-Type': 'application/json', [X_TSS_SERIALIZED]: 'true' } });
        }
        let nonStreamingBody = void 0;`;
const old1 = 'function parsePayload(payload) {\n    return fromJSON(payload, { plugins: serovalPlugins });\n  }';
const old2 = 'function parsePayload(payload) {\n    try { return fromJSON(payload, { plugins: serovalPlugins }); } catch (e) { return payload; }\n  }';

let replaced = s.includes(decoder);
if (!replaced) {
  if (s.includes(oldDecoder)) { s = s.replace(oldDecoder, decoder); replaced = true; }
}
if (!replaced) {
  for (const old of [old1, old2]) {
    if (s.includes(old)) { s = s.replace(old, decoder); replaced = true; break; }
  }
}
if (!replaced) { console.error('patch-server: parsePayload pattern not found — server.js format changed!'); process.exit(1); }
let responseReplaced = false;
if (s.includes(responseReplacement)) responseReplaced = true;
else if (responsePatch.test(s)) { s = s.replace(responsePatch, responseReplacement); responseReplaced = true; }
if (!responseReplaced) { console.error('patch-server: serializeResult pattern not found — server.js format changed!'); process.exit(1); }
writeFileSync(f, s);
console.log(`patch-server: request decoder applied; non-stream response serializer ${responseReplaced ? 'applied' : 'already present'}`);
