import { useEffect, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X, Volume2, VolumeX, Radar } from "lucide-react";
import { isSoundEnabled, setSoundEnabled, sfx, loadSoundPref } from "@/lib/sound";
import FreeIntelLogo from "@/components/ui/FreeIntelLogo";

const LINKS = [
  { to: "/discover", label: "DISCOVER" },
  { to: "/llm-apis", label: "FREE LLM APIS" },
  { to: "/models", label: "MODELS" },
  { to: "/playground", label: "PLAYGROUND" },
  { to: "/radar", label: "RADAR" },
  { to: "/stacks", label: "STACKS" },
  { to: "/save-money", label: "SAVE $$$$" },
  { to: "/deals", label: "DEALS" },
  { to: "/submit", label: "SUBMIT" }
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState(false);
  const loc = useLocation();

  useEffect(() => { setSound(loadSoundPref()); }, []);
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    if (next) setTimeout(() => sfx.verify(), 30);
  };

  return (
    <header className="fixed top-0 inset-x-0 z-50">
      <div className="glass border-x-0 border-t-0 rounded-none px-4 md:px-8 h-14 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 group shrink-0" onClick={() => sfx.click()}>
          <FreeIntelLogo size={32} showText />
        </Link>

        <nav className="hidden lg:flex items-center gap-0.5" aria-label="Primary">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              onClick={() => sfx.click()}
              className={({ isActive }) =>
                `relative px-3 py-2 font-mono text-[10.5px] tracking-[0.16em] transition-colors duration-200 ${
                  isActive ? "text-cyan" : "text-slate-400 hover:text-slate-100"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {l.label}
                  {isActive && (
                    <motion.span
                      layoutId="nav-underline"
                      className="absolute inset-x-2 -bottom-[13px] h-px bg-cyan"
                      style={{ boxShadow: "0 0 12px rgba(0,240,255,.8)" }}
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleSound}
            aria-label={`Sound ${sound ? "on" : "off"}`}
            className={`chip cursor-pointer select-none border-slate-600/40 ${
              sound ? "text-lime-neon border-lime-neon/50" : "text-slate-500"
            } hover:border-slate-400/60 transition-colors`}
          >
            {sound ? <Volume2 size={11} /> : <VolumeX size={11} />}
            SOUND: {sound ? "ON" : "OFF"}
          </button>
          <NavLink
            to="/admin"
            className="hidden md:inline-flex chip border-slate-600/40 text-slate-500 hover:text-slate-200 transition-colors"
          >
            ADMIN
          </NavLink>
          <button
            className="lg:hidden p-2 text-slate-300"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => { setOpen((v) => !v); sfx.click(); }}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="lg:hidden glass mx-3 mt-2 rounded-lg overflow-hidden"
            aria-label="Mobile"
          >
            {[...LINKS, { to: "/admin", label: "ADMIN CONSOLE" }].map((l, i) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `flex items-center justify-between px-5 py-3.5 font-mono text-xs tracking-[0.18em] border-b border-slate-700/30 last:border-0 ${
                    isActive ? "text-cyan bg-cyan/5" : "text-slate-300"
                  }`
                }
              >
                <span>{l.label}</span>
                <Radar size={13} className="text-slate-600" data-index={i} />
              </NavLink>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>

      {!isSoundEnabled() && null}
    </header>
  );
}
