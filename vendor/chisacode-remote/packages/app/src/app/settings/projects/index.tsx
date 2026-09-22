import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import SettingsScreen from "@/screens/settings-screen";

const PROJECTS_VIEW = { kind: "projects" as const };

export default function SettingsProjectsIndexRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <SettingsScreen view={PROJECTS_VIEW} />
    </HostRouteBootstrapBoundary>
  );
}
