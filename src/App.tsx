import { useEffect, Component, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Nav from "@/components/layout/Nav";
import Footer from "@/components/layout/Footer";
import BackgroundFX from "@/components/fx/BackgroundFX";
import Home from "@/pages/Home";
import Discover from "@/pages/Discover";
import LLMApis from "@/pages/LLMApis";
import OpenWeightModels from "@/pages/OpenWeightModels";
import Radar from "@/pages/Radar";
import ResourceDetail from "@/pages/ResourceDetail";
import Stacks from "@/pages/Stacks";
import SaveMoney from "@/pages/SaveMoney";
import GithubIntel from "@/pages/GithubIntel";
import Deals from "@/pages/Deals";
import Submit from "@/pages/Submit";
import Admin from "@/pages/Admin";
import AdminLogin from "@/pages/AdminLogin";
import Playground from "@/pages/Playground";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <div className="font-mono text-4xl font-bold text-red-neon mb-4">CRASH</div>
          <p className="text-slate-400 text-sm mb-4">Something went wrong rendering this page.</p>
          <pre className="text-xs text-slate-600 bg-slate-900 p-4 rounded text-left overflow-auto max-h-48">{this.state.error.message}</pre>
          <button onClick={() => { this.setState({ error: null }); window.location.reload(); }} className="btn-neon mt-6">RELOAD</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const TITLES: Record<string, string> = {
  "/": "Free Intel — Stop Paying For What You Can Get For Free",
  "/discover": "Discover Free Resources — Free Intel",
  "/llm-apis": "Free LLM API Comparison — Free Intel",
  "/models": "Open-Weight Model Tracker — Free Intel",
  "/radar": "Free Radar — Live Discoveries — Free Intel",
  "/stacks": "Free Stack Builder — Free Intel",
  "/save-money": "Cost Reduction Engine — Free Intel",
  "/github-intel": "GitHub Intelligence — Free Intel",
  "/deals": "Deals & Promotions — Free Intel",
  "/submit": "Submit a Discovery — Free Intel",
  "/admin": "Operations Console — Free Intel",
  "/admin/login": "Admin Login — Free Intel"
};

function RouteEffects() {
  const loc = useLocation();
  useEffect(() => {
    document.title = TITLES[loc.pathname] || "Free Intel — Free Resource Intelligence Platform";
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteEffects />
      <div className="relative min-h-screen">
        <BackgroundFX />
        <Nav />
        <main className="relative z-10 pt-14">
          <ErrorBoundary>
            <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/llm-apis" element={<LLMApis />} />
            <Route path="/models" element={<OpenWeightModels />} />
            <Route path="/radar" element={<Radar />} />
            <Route path="/resource/:slug" element={<ResourceDetail />} />
            <Route path="/stacks" element={<Stacks />} />
            <Route path="/save-money" element={<SaveMoney />} />
            <Route path="/github-intel" element={<GithubIntel />} />
            <Route path="/deals" element={<Deals />} />
            <Route path="/submit" element={<Submit />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="*" element={
              <div className="max-w-7xl mx-auto px-6 py-32 text-center">
                <div className="font-mono text-6xl font-bold grad-text mb-4">404</div>
                <p className="text-slate-400">Signal lost. This sector contains no intelligence.</p>
              </div>
            } />
          </Routes>
          </ErrorBoundary>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}
