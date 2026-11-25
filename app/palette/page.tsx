import { CmdK } from "@/components/mod/cmdk";

/* Standalone ⌘K: works without the shell (the bar opens directly), the shell just opens it as an overlay. */
export default function Palette() {
  return <CmdK standalone />;
}
