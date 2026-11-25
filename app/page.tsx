import { redirect } from "next/navigation";
import { Os } from "@/components/os";
import { company, onboarded } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Page() {
  if (!onboarded()) redirect("/onboarding");
  return <Os name={company()?.name} />;
}
