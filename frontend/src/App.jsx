import AdminApp, { adminRoute } from "./admin/AdminApp.jsx";
import PublicWaiverPage from "./PublicWaiverPage.jsx";

export default function App() {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const isWaiverPage = normalizedPath === "/waiver" || normalizedPath === "/";

  if (adminRoute(normalizedPath)) return <AdminApp />;
  if (isWaiverPage) return <PublicWaiverPage />;

  return (
    <main className="page">
      <section className="card">
        <header className="hero">
          <p className="kicker">Not Found</p>
          <h1>Page Not Found</h1>
          <p>Use /waiver for the public form or /admin for administration.</p>
        </header>
      </section>
    </main>
  );
}
