"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Banner, Card } from "@/components/ui/primitives";
import { Calculator } from "@/components/calculator/Calculator";

function CalculatorInner() {
  const params = useSearchParams();
  const [segment, setSegment] = useState<"RESI" | "ESS" | "CI">((params.get("segment") as "RESI" | "ESS" | "CI") ?? "RESI");
  return (
    <div className="space-y-4">
      <Banner>Quick estimates are never stored. To attach a sizing to a case, open the case and use its <b>Assessment</b> tab. Standard-system prices are indicative ranges (equipment, installation and GST shown separately); the final price is always the EPC partner&apos;s quote. No EMI is calculated.</Banner>
      <Card title="Energy calculator" right={<div className="flex gap-1">{(["RESI", "ESS", "CI"] as const).map((sg) => <button key={sg} type="button" className={`btn btn-sm ${segment === sg ? "btn-navy" : ""}`} onClick={() => setSegment(sg)}>{sg === "CI" ? "C&I" : sg}</button>)}</div>}>
        <Calculator segment={segment} />
      </Card>
    </div>
  );
}

export default function CalculatorPage() {
  return <Suspense><CalculatorInner /></Suspense>;
}
