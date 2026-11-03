import BackToSettings from "@/components/shell/BackToSettings";
import UpdatesPage from "@/components/pages/UpdatesPage";

export const metadata = { title: "Updates · Puneet Studios" };

export default function Page() {
  return (
    <>
      <BackToSettings />
      <UpdatesPage />
    </>
  );
}
