import { redirect } from "next/navigation";
import { Onboarding } from "@/components/onboarding";
import { onboarded, setupNeedsCode, TEMPLATE, DEFAULT_ACCENT } from "@/lib/config";
import "./onboarding.css";

export const dynamic = "force-dynamic";

export default function Page() {
  if (onboarded()) redirect("/");
  return <Onboarding template={TEMPLATE} accent={DEFAULT_ACCENT} needCode={setupNeedsCode()} />;
}
