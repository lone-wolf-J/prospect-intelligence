import "dotenv/config";
import { getSearchProviders } from "./server/lib/search-providers.js";
async function main() {
  const qs = ["\"Microsoft\" leadership team executives","\"Microsoft\" CEO CTO CFO COO founders","site:theorg.com \"Microsoft\"","\"Microsoft\" executive team management"];
  const providers = getSearchProviders();
  console.log("providers:", providers.map(p=>p.name).join(","));
  for (const q of qs) {
    for (const p of providers) {
      try {
        const res = await p.search(q, { num: 5 });
        console.log(`[${p.name}] ${q} -> ${res.length}`);
        for (const r of res) console.log("   ", r.url, "|", (r.title||"").slice(0,60));
        if (res.length) break;
      } catch (e:any) { console.log(`[${p.name}] fail`, e.message); }
    }
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
