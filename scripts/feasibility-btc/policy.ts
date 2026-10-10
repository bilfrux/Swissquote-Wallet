// Compile la politique de recovery avec le compilateur Miniscript de référence (sipa, via @bitcoinerlab/miniscript-policies)
// et l'analyse avec @bitcoinerlab/miniscript. Aucune clé ici : des marqueurs @C @B @S @T.
import { compilePolicy, ready } from "@bitcoinerlab/miniscript-policies";
import { analyzeMiniscript } from "@bitcoinerlab/miniscript";

export const DELAYS = { D1: Number(process.env.D1 ?? 6), D2: Number(process.env.D2 ?? 12), D3: Number(process.env.D3 ?? 24) };

export function policyString({ D1, D2, D3 } = DELAYS) {
  return `or(pk(@C),or(and(thresh(2,pk(@B),pk(@S)),older(${D1})),or(and(thresh(2,pk(@B),pk(@T)),older(${D2})),and(thresh(2,pk(@S),pk(@T)),older(${D3})))))`;
}

export async function compile(delays = DELAYS) {
  await ready;
  const policy = policyString(delays);
  const out = compilePolicy(policy);
  return { policy, ...out, analysis: analyzeMiniscript(out.miniscript) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await compile();
  console.log("politique  :", r.policy);
  console.log("miniscript :", r.miniscript);
  console.log("issane     :", r.issane);
  console.log("analyse    :", JSON.stringify(r.analysis));
}
