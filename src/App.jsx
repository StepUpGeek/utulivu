import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { saveCache, loadCache, getQueue, enqueueAction, removeFromQueue, queueCount } from "./offlineStore";
import {
  LayoutGrid, CalendarDays, Users, MessageSquareText, Wrench,
  Radio, Wallet, Building2, ChevronDown, Plus, X, Check, Bell, Menu
} from "lucide-react";

/* ---------------------------------------------------------
   Design tokens — "front desk, after hours" visual identity
   Ink navy + warm clay + a teal "signal" color reserved only
   for NFC tap moments, so the tap interaction reads as the
   one electrified accent against an otherwise calm palette.
--------------------------------------------------------- */
const C = {
  ink: "#16233B",
  inkSoft: "#3A4459",
  paper: "#F6F3ED",
  paperRaised: "#FFFFFF",
  line: "#E4DFD3",
  clay: "#B5673A",
  clayDeep: "#8F4E2A",
  signal: "#2F9E96",
  signalSoft: "#DCEFEC",
  amber: "#C79A3D",
  red: "#B24C4C",
};

const FONTS = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Work+Sans:wght@400;500;600&display=swap');
    .fr { font-family: 'Fraunces', serif; }
    .ws { font-family: 'Work Sans', sans-serif; }
    @keyframes ripple {
      0% { box-shadow: 0 0 0 0 rgba(47,158,150,0.45); }
      100% { box-shadow: 0 0 0 22px rgba(47,158,150,0); }
    }
    .tap-ripple { animation: ripple 1s ease-out; }
  `}</style>
);

/* ---------------------------------------------------------
   Branches, clients, services, bookings, invoices, inquiries,
   and tags now live in Supabase. These mapper functions convert
   a DB row (snake_case) into the camelCase shape the rest of
   this file already works with, so the UI code below didn't
   need to change.
--------------------------------------------------------- */
const mapBranch = (r) => ({ id: r.id, name: r.name, location: r.location });
const mapClient = (r) => ({ id: r.id, branchId: r.branch_id, name: r.name, phone: r.phone });
const mapService = (r) => ({ id: r.id, branchId: r.branch_id, name: r.name, price: r.price, category: r.category, billingUnit: r.billing_unit || "flat" });
const mapBooking = (r) => ({ id: r.id, branchId: r.branch_id, clientId: r.client_id, serviceIds: r.service_ids || [], checkIn: r.check_in, checkOut: r.check_out, status: r.status });
const mapInvoice = (r) => ({ id: r.id, branchId: r.branch_id, bookingId: r.booking_id, amount: r.amount, status: r.status });
const mapInquiry = (r) => ({ id: r.id, branchId: r.branch_id, clientId: r.client_id, message: r.message, status: r.status });
const mapTag = (r) => ({ id: r.id, branchId: r.branch_id, label: r.label, type: r.type, linkedName: r.linked_name, lastScan: r.last_scan });
const mapSubscriber = (r) => ({ id: r.id, name: r.name, tier: r.tier, branches: r.branches, activeBookings: r.active_bookings, subStatus: r.sub_status, mrr: r.mrr });

const TIER_OPTIONS = ["Essentials", "Growth", "Full Suite"];

/* Guest access codes and service requests also live in Supabase —
   see src/supabaseClient.js. This makes a code generated on one
   device actually work when a guest enters it on a different device. */

const INQUIRY_STAGES = ["new", "quoted", "confirmed", "completed"];
const money = (n) => "TSh " + n.toLocaleString();

function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut || checkIn === "TBC" || checkOut === "TBC") return 1;
  const inD = new Date(checkIn);
  const outD = new Date(checkOut);
  const diff = Math.round((outD - inD) / 86400000);
  return diff > 0 ? diff : 1;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 780px)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 780px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}


/* ---------------------------------------------------------
   Small building blocks
--------------------------------------------------------- */
function ConnectionBadge({ isOnline, usingCache, syncing, pendingCount }) {
  let label, bg, fg;
  if (syncing) {
    label = "Syncing…";
    bg = "#E4E9F3"; fg = "#3A4E8A";
  } else if (!isOnline) {
    label = pendingCount > 0 ? `Offline · ${pendingCount} to sync` : "Offline";
    bg = "#F3DEDE"; fg = "#B24C4C";
  } else if (usingCache || pendingCount > 0) {
    label = `Online · ${pendingCount} pending`;
    bg = "#F3E7CE"; fg = "#8A6A1E";
  } else {
    label = "Online";
    bg = "#DCEFEC"; fg = "#1E6E67";
  }
  return (
    <span className="ws" style={{ background: bg, color: fg, fontSize: "12px", fontWeight: 500, padding: "5px 11px", borderRadius: "999px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Pill({ tone = "default", children }) {
  const tones = {
    default: { bg: C.line, fg: C.inkSoft },
    confirmed: { bg: C.signalSoft, fg: C.clayDeep === C.clayDeep ? "#1E6E67" : C.signal },
    pending: { bg: "#F3E7CE", fg: "#8A6A1E" },
    paid: { bg: C.signalSoft, fg: "#1E6E67" },
    outstanding: { bg: "#F3DEDE", fg: C.red },
    new: { bg: "#F3E7CE", fg: "#8A6A1E" },
    quoted: { bg: "#E4E9F3", fg: "#3A4E8A" },
    completed: { bg: C.signalSoft, fg: "#1E6E67" },
    cancelled: { bg: "#F3DEDE", fg: C.red },
    void: { bg: C.line, fg: C.inkSoft },
  };
  const t = tones[tone] || tones.default;
  return (
    <span className="ws" style={{
      background: t.bg, color: t.fg, fontSize: "12.5px", fontWeight: 500,
      padding: "3px 10px", borderRadius: "999px", whiteSpace: "nowrap"
    }}>
      {children}
    </span>
  );
}

const BOOKING_STATUSES = ["pending", "confirmed", "completed", "cancelled"];

function StatusPicker({ value, onChange }) {
  const tones = {
    pending: { bg: "#F3E7CE", fg: "#8A6A1E" },
    confirmed: { bg: C.signalSoft, fg: "#1E6E67" },
    completed: { bg: "#E4E9F3", fg: "#3A4E8A" },
    cancelled: { bg: "#F3DEDE", fg: C.red },
  };
  const t = tones[value] || tones.pending;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="ws"
      style={{
        background: t.bg, color: t.fg, fontSize: "12.5px", fontWeight: 500,
        padding: "4px 8px", borderRadius: "999px", border: "none", cursor: "pointer",
      }}
    >
      {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

const INVOICE_STATUSES = ["outstanding", "paid", "void"];

function InvoiceStatusPicker({ value, onChange }) {
  const tones = {
    outstanding: { bg: "#F3DEDE", fg: C.red },
    paid: { bg: C.signalSoft, fg: "#1E6E67" },
    void: { bg: C.line, fg: C.inkSoft },
  };
  const t = tones[value] || tones.outstanding;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="ws"
      style={{
        background: t.bg, color: t.fg, fontSize: "12.5px", fontWeight: 500,
        padding: "4px 8px", borderRadius: "999px", border: "none", cursor: "pointer",
      }}
    >
      {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

function NavItem({ icon: Icon, label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className="ws"
      style={{
        display: "flex", alignItems: "center", gap: "10px",
        width: "100%", textAlign: "left", padding: "9px 14px",
        borderRadius: "8px", border: "none", cursor: "pointer",
        background: active ? "rgba(255,255,255,0.1)" : "transparent",
        color: active ? "#FFFFFF" : "rgba(255,255,255,0.62)",
        fontSize: "14.5px", fontWeight: 500, transition: "background 120ms",
      }}
    >
      <Icon size={17} strokeWidth={2} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge ? (
        <span style={{
          background: C.signal, color: "#fff", fontSize: "11px", fontWeight: 600,
          borderRadius: "999px", padding: "1px 7px", minWidth: "18px", textAlign: "center"
        }}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function Panel({ title, action, children }) {
  return (
    <div style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "10px" }}>
      {title && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 20px", borderBottom: `1px solid ${C.line}`
        }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "18px", fontWeight: 500, color: C.ink }}>{title}</h3>
          {action}
        </div>
      )}
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------
   Login
--------------------------------------------------------- */
function Login({ onSignIn, onBack }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  async function handleSignIn() {
    setSigningIn(true);
    setError("");
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSigningIn(false);
    if (authError || !data.session) {
      setError("Incorrect email or password.");
      return;
    }
    onSignIn(data.session);
  }

  return (
    <div style={{
      minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center",
      background: C.paper
    }}>
      {FONTS}
      <div style={{
        width: "min(360px, 92vw)", background: C.paperRaised, border: `1px solid ${C.line}`,
        borderRadius: "14px", padding: "36px 32px"
      }}>
        <div style={{
          width: "40px", height: "40px", borderRadius: "9px", background: C.ink,
          display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "22px"
        }}>
          <Radio size={19} color={C.signal} strokeWidth={2.2} />
        </div>
        <h1 className="fr" style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: 500, color: C.ink }}>
          Utulivu
        </h1>
        <p className="ws" style={{ margin: "0 0 26px", fontSize: "14px", color: C.inkSoft }}>
          Sign in to manage your property.
        </p>
        <label className="ws" style={{ fontSize: "12.5px", color: C.inkSoft, display: "block", marginBottom: "6px" }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
          className="ws"
          style={{
            width: "100%", padding: "10px 12px", borderRadius: "8px",
            border: `1px solid ${C.line}`, marginBottom: "14px", fontSize: "14px",
            outlineColor: C.signal, boxSizing: "border-box"
          }}
        />
        <label className="ws" style={{ fontSize: "12.5px", color: C.inkSoft, display: "block", marginBottom: "6px" }}>
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
          className="ws"
          style={{
            width: "100%", padding: "10px 12px", borderRadius: "8px",
            border: `1px solid ${C.line}`, marginBottom: "10px", fontSize: "14px",
            outlineColor: C.signal, boxSizing: "border-box"
          }}
        />
        {error && <p style={{ color: C.red, fontSize: "12.5px", margin: "0 0 12px" }}>{error}</p>}
        <button
          onClick={handleSignIn}
          disabled={signingIn || !email.trim() || !password}
          className="ws"
          style={{
            width: "100%", padding: "11px", borderRadius: "8px", border: "none",
            background: C.ink, color: "#fff", fontSize: "14.5px", fontWeight: 500,
            cursor: signingIn ? "default" : "pointer", opacity: signingIn ? 0.7 : 1, marginTop: "4px"
          }}
        >
          {signingIn ? "Signing in…" : "Sign in"}
        </button>
        {onBack && (
          <button onClick={onBack} className="ws" style={{ width: "100%", marginTop: "10px", padding: "9px", borderRadius: "8px", border: `1px solid ${C.line}`, background: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
            ← Choose a different portal
          </button>
        )}
        <p className="ws" style={{ marginTop: "16px", fontSize: "12px", color: C.inkSoft }}>
          Demo data only — nothing here is saved beyond this session.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Main app
--------------------------------------------------------- */
function ProviderApp({ onExit, onGenerateCode, onJumpToGuest }) {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [role, setRole] = useState(null); // 'owner' | 'staff' | null while loading
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(null);
  const [tab, setTab] = useState("dashboard");

  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [tags, setTags] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [showAddBooking, setShowAddBooking] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [tapFlash, setTapFlash] = useState(null);
  const [generatedCode, setGeneratedCode] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);
  const [editingBooking, setEditingBooking] = useState(null);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [generatingId, setGeneratingId] = useState(null);
  const [requests, setRequests] = useState([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [usingCache, setUsingCache] = useState(false);
  const [pendingCount, setPendingCount] = useState(queueCount());
  const [syncing, setSyncing] = useState(false);

  function applyFetchedData(b, c, s, bk, inv, iq, t) {
    const mapped = {
      branches: b ? b.map(mapBranch) : [],
      clients: c ? c.map(mapClient) : [],
      services: s ? s.map(mapService) : [],
      bookings: bk ? bk.map(mapBooking) : [],
      invoices: inv ? inv.map(mapInvoice) : [],
      inquiries: iq ? iq.map(mapInquiry) : [],
      tags: t ? t.map(mapTag) : [],
    };
    setBranches(mapped.branches);
    setClients(mapped.clients);
    setServices(mapped.services);
    setBookings(mapped.bookings);
    setInvoices(mapped.invoices);
    setInquiries(mapped.inquiries);
    setTags(mapped.tags);
    setBranchId((prev) => prev || mapped.branches[0]?.id || null);
    saveCache(mapped);
    setUsingCache(false);
  }

  async function fetchAll() {
    try {
      const [b, c, s, bk, inv, iq, t] = await Promise.all([
        supabase.from("branches").select("*"),
        supabase.from("clients").select("*"),
        supabase.from("services").select("*"),
        supabase.from("bookings").select("*"),
        supabase.from("invoices").select("*"),
        supabase.from("inquiries").select("*"),
        supabase.from("tags").select("*"),
      ]);
      if (b.error) throw b.error;
      applyFetchedData(b.data, c.data, s.data, bk.data, inv.data, iq.data, t.data);
      setIsOnline(true);
    } catch (e) {
      // No connection (or Supabase unreachable) — fall back to whatever we last cached locally.
      const cached = loadCache();
      if (cached) {
        setBranches(cached.branches || []);
        setClients(cached.clients || []);
        setServices(cached.services || []);
        setBookings(cached.bookings || []);
        setInvoices(cached.invoices || []);
        setInquiries(cached.inquiries || []);
        setTags(cached.tags || []);
        setBranchId((prev) => prev || cached.branches?.[0]?.id || null);
        setUsingCache(true);
      }
      setIsOnline(false);
    }
    setDataLoading(false);
  }

  async function syncPending() {
    const queue = getQueue();
    if (queue.length === 0) {
      fetchAll();
      return;
    }
    setSyncing(true);
    const idMap = {}; // maps a temporary offline id -> the real id Supabase assigns
    for (const action of queue) {
      try {
        if (action.type === "addClient") {
          const { data, error } = await supabase.from("clients").insert(action.payload).select().single();
          if (error) throw error;
          idMap[action.tempId] = data.id;
        } else if (action.type === "addBooking") {
          const payload = { ...action.payload };
          if (idMap[payload.client_id]) payload.client_id = idMap[payload.client_id];
          const { error } = await supabase.from("bookings").insert(payload);
          if (error) throw error;
        } else if (action.type === "updateBookingStatus") {
          const { error } = await supabase.from("bookings").update({ status: action.payload.status }).eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "updateInquiryStatus") {
          const { error } = await supabase.from("inquiries").update({ status: action.payload.status }).eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "tapTag") {
          const { error } = await supabase.from("tags").update({ last_scan: action.payload.stamp }).eq("id", action.payload.tagId);
          if (error) throw error;
          if (action.payload.inquiry) {
            const { error: iqErr } = await supabase.from("inquiries").insert(action.payload.inquiry);
            if (iqErr) throw iqErr;
          }
        } else if (action.type === "addInvoice") {
          const { error } = await supabase.from("invoices").insert(action.payload);
          if (error) throw error;
        } else if (action.type === "updateInvoiceStatus") {
          const { error } = await supabase.from("invoices").update({ status: action.payload.status }).eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "editBooking") {
          const { error } = await supabase.from("bookings").update(action.payload.updates).eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "deleteBooking") {
          const { error } = await supabase.from("bookings").delete().eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "deleteClient") {
          const { error } = await supabase.from("clients").delete().eq("id", action.payload.id);
          if (error) throw error;
        }
        removeFromQueue(action.id);
      } catch (e) {
        // Still offline, or this one failed — stop here and try again next time we're online.
        setSyncing(false);
        setPendingCount(queueCount());
        return;
      }
    }
    setPendingCount(queueCount());
    setSyncing(false);
    fetchAll();
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setRole(null);
      return;
    }
    supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => setRole(data?.role || "staff"));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    fetchAll();
    if (navigator.onLine && queueCount() > 0) syncPending();

    function handleOnline() {
      setIsOnline(true);
      syncPending();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    supabase
      .from("service_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setRequests(data);
      });

    const requestsChannel = supabase
      .channel("service_requests_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "service_requests" }, (payload) => {
        setRequests((prev) => [payload.new, ...prev]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "service_requests" }, (payload) => {
        setRequests((prev) => prev.map((r) => (r.id === payload.new.id ? payload.new : r)));
      })
      .subscribe();

    const bookingsChannel = supabase
      .channel("bookings_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bookings" }, (payload) => {
        setBookings((prev) => (prev.some((bk) => bk.id === payload.new.id) ? prev : [...prev, mapBooking(payload.new)]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bookings" }, (payload) => {
        setBookings((prev) => prev.map((bk) => (bk.id === payload.new.id ? mapBooking(payload.new) : bk)));
      })
      .subscribe();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      supabase.removeChannel(requestsChannel);
      supabase.removeChannel(bookingsChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function markRequestHandled(id) {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "handled" } : r)));
    try {
      const { error } = await supabase.from("service_requests").update({ status: "handled" }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      // handled locally; will reconcile next successful fetch — request-handling isn't queued
      // since it's low-stakes and the live subscription will correct it once back online.
    }
  }

  if (session === undefined) {
    return (
      <div style={{ minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, color: C.inkSoft }}>
        {FONTS}
        <p className="ws">Loading…</p>
      </div>
    );
  }
  if (!session) return <Login onSignIn={setSession} onBack={onExit} />;
  if (dataLoading || !branchId) {
    return (
      <div style={{ minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, color: C.inkSoft }}>
        {FONTS}
        <p className="ws">Loading…</p>
      </div>
    );
  }

  const branch = branches.find((b) => b.id === branchId);
  const inBranch = (arr) => arr.filter((x) => x.branchId === branchId);
  const bClients = inBranch(clients);
  const bServices = inBranch(services);
  const bBookings = inBranch(bookings);
  const bInquiries = inBranch(inquiries);
  const bTags = inBranch(tags);
  const bInvoices = inBranch(invoices);

  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";
  const serviceNames = (ids) => ids.map((id) => services.find((s) => s.id === id)?.name).join(", ");

  const revenue = bInvoices.filter((v) => v.status === "paid").reduce((sum, v) => sum + v.amount, 0);
  const outstanding = bInvoices.filter((v) => v.status === "outstanding").reduce((sum, v) => sum + v.amount, 0);

  async function simulateTap(tagId) {
    const tag = tags.find((t) => t.id === tagId);
    if (!tag) return;
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setTags((prev) => prev.map((t) => (t.id === tagId ? { ...t, lastScan: stamp } : t)));
    setTapFlash(tagId);
    setTimeout(() => setTapFlash(null), 1000);

    const inquiryPayload =
      tag.type === "Service request"
        ? { branch_id: tag.branchId, client_id: bClients[0]?.id || null, message: "Tap request from " + tag.label, status: "new" }
        : null;

    try {
      const { error } = await supabase.from("tags").update({ last_scan: stamp }).eq("id", tagId);
      if (error) throw error;
      if (inquiryPayload) {
        const { data, error: iqErr } = await supabase.from("inquiries").insert(inquiryPayload).select().single();
        if (iqErr) throw iqErr;
        if (data) setInquiries((prev) => [mapInquiry(data), ...prev]);
      }
    } catch (e) {
      enqueueAction({ type: "tapTag", payload: { tagId, stamp, inquiry: inquiryPayload } });
      setPendingCount(queueCount());
      if (inquiryPayload) {
        setInquiries((prev) => [{ id: "pending-" + Date.now(), branchId: inquiryPayload.branch_id, clientId: inquiryPayload.client_id, message: inquiryPayload.message, status: inquiryPayload.status }, ...prev]);
      }
    }
  }

  async function moveInquiry(id, dir) {
    const iq = inquiries.find((x) => x.id === id);
    if (!iq) return;
    const idx = INQUIRY_STAGES.indexOf(iq.status);
    const next = INQUIRY_STAGES[Math.min(Math.max(idx + dir, 0), INQUIRY_STAGES.length - 1)];
    setInquiries((prev) => prev.map((x) => (x.id === id ? { ...x, status: next } : x)));
    try {
      const { error } = await supabase.from("inquiries").update({ status: next }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "updateInquiryStatus", payload: { id, status: next } });
      setPendingCount(queueCount());
    }
  }

  async function updateBookingStatus(id, status) {
    const bk = bookings.find((b) => b.id === id);
    setBookings((prev) => prev.map((bk) => (bk.id === id ? { ...bk, status } : bk)));
    try {
      const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "updateBookingStatus", payload: { id, status } });
      setPendingCount(queueCount());
    }

    // Confirming a booking issues its invoice, if it doesn't have one yet.
    // Cancelling voids whatever invoice exists. Completing leaves the invoice
    // as-is — Finance flags it if it's still unpaid after checkout, rather
    // than silently marking it paid.
    if (!bk) return;
    const existingInvoice = invoices.find((v) => v.bookingId === id);

    if (status === "confirmed" && !existingInvoice) {
      const nights = nightsBetween(bk.checkIn, bk.checkOut);
      const amount = bk.serviceIds.reduce((sum, sid) => {
        const svc = services.find((s) => s.id === sid);
        if (!svc) return sum;
        const qty = svc.billingUnit === "per_night" ? nights : 1;
        return sum + svc.price * qty;
      }, 0);
      const payload = { branch_id: branchId, booking_id: id, amount, status: "outstanding" };
      try {
        const { data, error } = await supabase.from("invoices").insert(payload).select().single();
        if (error) throw error;
        setInvoices((prev) => [...prev, mapInvoice(data)]);
      } catch (e) {
        enqueueAction({ type: "addInvoice", payload });
        setPendingCount(queueCount());
        setInvoices((prev) => [...prev, { id: "temp-" + Date.now(), branchId, bookingId: id, amount, status: "outstanding" }]);
      }
    } else if (status === "cancelled" && existingInvoice && existingInvoice.status !== "void" && role === "owner") {
      await updateInvoiceStatus(existingInvoice.id, "void");
    }
  }

  async function updateInvoiceStatus(id, status) {
    if (role !== "owner") return; // staff can't change invoice status — enforced server-side too
    setInvoices((prev) => prev.map((v) => (v.id === id ? { ...v, status } : v)));
    try {
      const { error } = await supabase.from("invoices").update({ status }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "updateInvoiceStatus", payload: { id, status } });
      setPendingCount(queueCount());
    }
  }

  async function saveBookingEdit(id, updates) {
    if (role !== "owner") return; // enforced server-side too, via the booking_edit_guard trigger
    const dbUpdates = {
      client_id: updates.clientId,
      service_ids: updates.serviceIds,
      check_in: updates.checkIn,
      check_out: updates.checkOut,
    };
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...updates } : b)));
    try {
      const { error } = await supabase.from("bookings").update(dbUpdates).eq("id", id);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "editBooking", payload: { id, updates: dbUpdates } });
      setPendingCount(queueCount());
    }
    setEditingBooking(null);
  }

  async function deleteBooking(id) {
    if (role !== "owner") return;
    if (!window.confirm("Delete this booking? This can't be undone.")) return;
    setBookings((prev) => prev.filter((b) => b.id !== id));
    try {
      const { error } = await supabase.from("bookings").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "deleteBooking", payload: { id } });
      setPendingCount(queueCount());
    }
  }

  async function deleteClient(id) {
    if (role !== "owner") return;
    if (!window.confirm("Delete this client? This can't be undone.")) return;
    const prevClients = clients;
    setClients((prev) => prev.filter((c) => c.id !== id));
    try {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      if (e?.code === "23503") {
        setClients(prevClients);
        alert("Can't delete this client — they have existing bookings. Remove those first.");
      } else {
        enqueueAction({ type: "deleteClient", payload: { id } });
        setPendingCount(queueCount());
      }
    }
  }

  async function generateGuestCode(bk) {
    setGeneratingId(bk.id);
    const code = "UTU-" + Math.floor(1000 + Math.random() * 9000);
    const checkoutDate = bk.checkOut && bk.checkOut !== "TBC" ? bk.checkOut : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const expiresAt = `${checkoutDate}T12:00:00`;
    const inv = invoices.find((v) => v.bookingId === bk.id);
    const entry = {
      code,
      branch_id: branchId,
      guest_name: clientName(bk.clientId),
      service_names: serviceNames(bk.serviceIds),
      check_in: bk.checkIn,
      check_out: bk.checkOut,
      status: bk.status,
      invoice_amount: inv ? inv.amount : null,
      invoice_status: inv ? inv.status : null,
      expires_at: expiresAt,
    };
    const ok = await onGenerateCode(entry);
    setGeneratingId(null);
    if (ok) setGeneratedCode(entry);
  }

  const newRequestCount = requests.filter((r) => r.status === "new").length;

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
    { id: "requests", label: "Requests", icon: Bell, badge: newRequestCount || null },
    { id: "bookings", label: "Bookings", icon: CalendarDays },
    { id: "clients", label: "Clients", icon: Users },
    { id: "inquiries", label: "Inquiries", icon: MessageSquareText },
    { id: "services", label: "Services", icon: Wrench },
    { id: "tags", label: "NFC tags", icon: Radio },
    { id: "finance", label: "Finance", icon: Wallet },
  ];

  return (
    <div className="ws" style={{ display: "flex", minHeight: "640px", background: C.paper, color: C.ink, position: "relative", overflowX: "hidden" }}>
      {FONTS}

      {/* Backdrop for the mobile sidebar drawer */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(22,35,59,0.4)", zIndex: 15 }}
        />
      )}

      {/* Sidebar */}
      <div style={{
        width: "220px", background: C.ink, padding: "20px 14px", display: "flex", flexDirection: "column", flexShrink: 0,
        ...(isMobile
          ? {
              position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 16,
              transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
              transition: "transform 200ms ease", boxShadow: sidebarOpen ? "4px 0 16px rgba(0,0,0,0.2)" : "none"
            }
          : {})
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "0 6px 20px" }}>
          <div style={{ width: "26px", height: "26px", borderRadius: "7px", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Radio size={14} color={C.signal} />
          </div>
          <span className="fr" style={{ color: "#fff", fontSize: "16px", fontWeight: 500 }}>Utulivu</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {NAV.map((n) => (
            <NavItem key={n.id} icon={n.icon} label={n.label} active={tab === n.id} onClick={() => { setTab(n.id); setSidebarOpen(false); }} badge={n.badge} />
          ))}
        </div>
        <div style={{ marginTop: "auto", padding: "12px 6px 0", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px", margin: "12px 0 2px" }}>{session.user.email}</p>
          {role && <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px", margin: "0 0 6px", textTransform: "capitalize" }}>{role}</p>}
          <div style={{ display: "flex", gap: "12px" }}>
            <button onClick={() => supabase.auth.signOut()} className="ws" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", fontSize: "12px", cursor: "pointer", padding: 0 }}>
              Sign out
            </button>
            {onExit && (
              <button onClick={onExit} className="ws" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", fontSize: "12px", cursor: "pointer", padding: 0 }}>
                ← Switch portal
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top bar */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px",
          padding: isMobile ? "14px 16px" : "16px 28px", borderBottom: `1px solid ${C.line}`, position: "relative"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {isMobile && (
              <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: "7px", padding: "8px", cursor: "pointer", display: "flex" }}>
                <Menu size={18} color={C.ink} />
              </button>
            )}
            <h2 className="fr" style={{ margin: 0, fontSize: isMobile ? "18px" : "21px", fontWeight: 500, textTransform: "capitalize" }}>
              {tab === "tags" ? "NFC tags" : tab}
            </h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <ConnectionBadge isOnline={isOnline} usingCache={usingCache} syncing={syncing} pendingCount={pendingCount} />
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowBranchMenu((s) => !s)}
              style={{
                display: "flex", alignItems: "center", gap: "8px", background: C.paperRaised,
                border: `1px solid ${C.line}`, borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "14px"
              }}
            >
              <Building2 size={15} color={C.clay} />
              {branch.name}
              <ChevronDown size={14} />
            </button>
            {showBranchMenu && (
              <div style={{
                position: "absolute", right: 0, top: "42px", background: C.paperRaised,
                border: `1px solid ${C.line}`, borderRadius: "8px", boxShadow: "0 6px 18px rgba(22,35,59,0.12)",
                width: "220px", zIndex: 10
              }}>
                {branches.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => { setBranchId(b.id); setShowBranchMenu(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                      border: "none", background: b.id === branchId ? C.paper : "transparent", cursor: "pointer", fontSize: "13.5px"
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{b.name}</div>
                    <div style={{ fontSize: "12px", color: C.inkSoft }}>{b.location}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: isMobile ? "16px" : "24px 28px", overflowY: "auto", flex: 1 }}>

          {tab === "dashboard" && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? "10px" : "16px" }}>
              {[
                ["Active bookings", bBookings.filter((b) => b.status === "confirmed").length],
                ["Open inquiries", bInquiries.filter((i) => i.status !== "completed").length],
                ["Revenue collected", money(revenue)],
                ["Outstanding", money(outstanding)],
              ].map(([label, val]) => (
                <div key={label} style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "10px", padding: "18px" }}>
                  <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "8px" }}>{label}</div>
                  <div className="fr" style={{ fontSize: "24px", fontWeight: 500 }}>{val}</div>
                </div>
              ))}
              <div style={{ gridColumn: isMobile ? "span 2" : "span 4" }}>
                <Panel title="Recent inquiries">
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {bInquiries.slice(0, 4).map((iq) => (
                      <div key={iq.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
                        <div>
                          <div style={{ fontSize: "14px", fontWeight: 500 }}>{clientName(iq.clientId)}</div>
                          <div style={{ fontSize: "13px", color: C.inkSoft }}>{iq.message}</div>
                        </div>
                        <Pill tone={iq.status}>{iq.status}</Pill>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </div>
          )}

          {tab === "requests" && (
            <Panel title="Guest requests">
              <p style={{ fontSize: "13.5px", color: C.inkSoft, marginTop: 0, marginBottom: "18px" }}>
                Live requests sent from the Guest portal — this list updates automatically, no refresh needed.
              </p>
              {requests.length === 0 ? (
                <p style={{ fontSize: "13.5px", color: C.inkSoft }}>No requests yet. Try sending one from the Guest portal.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {requests.map((r) => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px", border: `1px solid ${C.line}`, borderRadius: "9px" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 500 }}>{r.message}</div>
                        <div style={{ fontSize: "12px", color: C.inkSoft, marginTop: "3px" }}>
                          {new Date(r.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                        </div>
                      </div>
                      {r.status === "handled" ? (
                        <Pill tone="completed">handled</Pill>
                      ) : (
                        <button
                          onClick={() => markRequestHandled(r.id)}
                          style={{ fontSize: "12.5px", border: "none", background: C.signal, color: "#fff", borderRadius: "6px", padding: "6px 12px", cursor: "pointer" }}
                        >
                          Mark handled
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {tab === "bookings" && (
            <Panel
              title="Bookings"
              action={
                <button onClick={() => setShowAddBooking(true)} style={{ display: "flex", alignItems: "center", gap: "6px", background: C.clay, color: "#fff", border: "none", borderRadius: "7px", padding: "8px 13px", fontSize: "13.5px", cursor: "pointer" }}>
                  <Plus size={15} /> New booking
                </button>
              }
            >
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
                    <th style={{ paddingBottom: "10px" }}>Client</th>
                    <th>Services</th>
                    <th>Dates</th>
                    <th>Status</th>
                    <th>Guest access</th>
                    {role === "owner" && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {bBookings.map((bk) => (
                    <tr key={bk.id} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ padding: "10px 0" }}>{clientName(bk.clientId)}</td>
                      <td>{serviceNames(bk.serviceIds)}</td>
                      <td>{bk.checkIn} → {bk.checkOut}</td>
                      <td><StatusPicker value={bk.status} onChange={(s) => updateBookingStatus(bk.id, s)} /></td>
                      <td>
                        <button
                          onClick={() => generateGuestCode(bk)}
                          disabled={generatingId === bk.id}
                          style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "5px 10px", cursor: generatingId === bk.id ? "default" : "pointer", color: C.clayDeep, opacity: generatingId === bk.id ? 0.6 : 1 }}
                        >
                          {generatingId === bk.id ? "Generating…" : "Generate code"}
                        </button>
                      </td>
                      {role === "owner" && (
                        <td>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              onClick={() => setEditingBooking(bk)}
                              style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", color: C.ink }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteBooking(bk.id)}
                              style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", color: C.red }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Panel>
          )}

          {tab === "clients" && (
            <Panel
              title="Clients"
              action={
                <button onClick={() => setShowAddClient(true)} style={{ display: "flex", alignItems: "center", gap: "6px", background: C.clay, color: "#fff", border: "none", borderRadius: "7px", padding: "8px 13px", fontSize: "13.5px", cursor: "pointer" }}>
                  <Plus size={15} /> New client
                </button>
              }
            >
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "14px" }}>
                {bClients.map((c) => (
                  <div key={c.id} style={{ border: `1px solid ${C.line}`, borderRadius: "9px", padding: "14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: "4px" }}>{c.name}</div>
                      <div style={{ fontSize: "13px", color: C.inkSoft }}>{c.phone}</div>
                    </div>
                    {role === "owner" && (
                      <button
                        onClick={() => deleteClient(c.id)}
                        style={{ fontSize: "12px", border: "none", background: "none", color: C.red, cursor: "pointer", padding: "2px" }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                ))}
                {bClients.length === 0 && (
                  <div style={{ fontSize: "13.5px", color: C.inkSoft }}>No clients yet for this branch.</div>
                )}
              </div>
            </Panel>
          )}

          {tab === "inquiries" && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: "14px" }}>
              {INQUIRY_STAGES.map((stage, colIdx) => (
                <div key={stage}>
                  <div style={{ fontSize: "12.5px", fontWeight: 600, color: C.inkSoft, textTransform: "capitalize", marginBottom: "10px" }}>{stage}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {bInquiries.filter((i) => i.status === stage).map((iq) => (
                      <div key={iq.id} style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "8px", padding: "12px" }}>
                        <div style={{ fontSize: "13.5px", fontWeight: 500 }}>{clientName(iq.clientId)}</div>
                        <div style={{ fontSize: "13px", color: C.inkSoft, margin: "4px 0 8px" }}>{iq.message}</div>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button disabled={colIdx === 0} onClick={() => moveInquiry(iq.id, -1)} style={{ fontSize: "12px", border: `1px solid ${C.line}`, background: "none", borderRadius: "5px", padding: "3px 7px", cursor: colIdx === 0 ? "default" : "pointer", opacity: colIdx === 0 ? 0.4 : 1 }}>← back</button>
                          <button disabled={colIdx === INQUIRY_STAGES.length - 1} onClick={() => moveInquiry(iq.id, 1)} style={{ fontSize: "12px", border: `1px solid ${C.line}`, background: "none", borderRadius: "5px", padding: "3px 7px", cursor: colIdx === 3 ? "default" : "pointer", opacity: colIdx === 3 ? 0.4 : 1 }}>advance →</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "services" && (
            <Panel title="Service catalog">
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
                    <th style={{ paddingBottom: "10px" }}>Service</th>
                    <th>Category</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {bServices.map((s) => (
                    <tr key={s.id} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ padding: "10px 0" }}>{s.name}</td>
                      <td>{s.category}</td>
                      <td>{money(s.price)}{s.billingUnit === "per_night" ? "/night" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Panel>
          )}

          {tab === "tags" && (
            <Panel title="NFC tags">
              <p style={{ fontSize: "13.5px", color: C.inkSoft, marginTop: 0, marginBottom: "18px" }}>
                Tap a tag below to simulate a guest or staff scan — a room tag logs a scan, a service-request tag opens a new inquiry.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: "14px" }}>
                {bTags.map((t) => (
                  <div
                    key={t.id}
                    className={tapFlash === t.id ? "tap-ripple" : ""}
                    style={{ border: `1px solid ${C.line}`, borderRadius: "9px", padding: "16px", textAlign: "center" }}
                  >
                    <Radio size={20} color={C.signal} style={{ marginBottom: "8px" }} />
                    <div style={{ fontWeight: 500, fontSize: "14px" }}>{t.label}</div>
                    <div style={{ fontSize: "12.5px", color: C.inkSoft, margin: "3px 0 12px" }}>{t.type} · {t.linkedName}</div>
                    <button
                      onClick={() => simulateTap(t.id)}
                      style={{ background: C.signal, color: "#fff", border: "none", borderRadius: "7px", padding: "7px 14px", fontSize: "13px", cursor: "pointer", width: "100%" }}
                    >
                      Simulate tap
                    </button>
                    {t.lastScan && <div style={{ fontSize: "11.5px", color: C.inkSoft, marginTop: "8px" }}>Last scan: {t.lastScan}</div>}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {tab === "finance" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
                <div style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "10px", padding: "18px" }}>
                  <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "8px" }}>Collected this period</div>
                  <div className="fr" style={{ fontSize: "24px" }}>{money(revenue)}</div>
                </div>
                <div style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "10px", padding: "18px" }}>
                  <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "8px" }}>Outstanding</div>
                  <div className="fr" style={{ fontSize: "24px", color: C.red }}>{money(outstanding)}</div>
                </div>
              </div>
              <Panel title="Invoices">
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
                      <th style={{ paddingBottom: "10px" }}>Booking</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bInvoices.map((v) => {
                      const bk = bookings.find((b) => b.id === v.bookingId);
                      const unpaidAfterCheckout = bk?.status === "completed" && v.status === "outstanding";
                      return (
                        <tr key={v.id} style={{ borderTop: `1px solid ${C.line}` }}>
                          <td style={{ padding: "10px 0" }}>{bk ? clientName(bk.clientId) : "—"}</td>
                          <td>{money(v.amount)}</td>
                          <td>
                            {role === "owner" ? (
                              <InvoiceStatusPicker value={v.status} onChange={(s) => updateInvoiceStatus(v.id, s)} />
                            ) : (
                              <Pill tone={v.status}>{v.status}</Pill>
                            )}
                            {unpaidAfterCheckout && (
                              <div style={{ fontSize: "11.5px", color: C.red, marginTop: "4px" }}>Guest checked out — still unpaid</div>
                            )}
                          </td>
                          <td>
                            <button
                              onClick={() => setPrintInvoice({ invoice: v, booking: bk })}
                              style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", color: C.clayDeep }}
                            >
                              Print
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>

      {/* Printable invoice modal */}
      {printInvoice && (
        <InvoicePrintModal
          data={printInvoice}
          branch={branch}
          clientName={clientName}
          serviceNames={serviceNames}
          services={services}
          onClose={() => setPrintInvoice(null)}
        />
      )}

      {/* Add booking modal */}
      {showAddBooking && (
        <AddBookingModal
          clients={bClients}
          services={bServices.filter((s) => s.category !== "Amenities")}
          onClose={() => setShowAddBooking(false)}
          onAddClient={async (newClient) => {
            const payload = { branch_id: branchId, name: newClient.name, phone: newClient.phone };
            try {
              const { data, error } = await supabase.from("clients").insert(payload).select().single();
              if (error) throw error;
              const client = mapClient(data);
              setClients((prev) => [...prev, client]);
              return client;
            } catch (e) {
              const tempId = "temp-" + Date.now();
              enqueueAction({ type: "addClient", payload, tempId });
              setPendingCount(queueCount());
              const client = { id: tempId, branchId, name: newClient.name, phone: newClient.phone };
              setClients((prev) => [...prev, client]);
              return client;
            }
          }}
          onSave={async (newBooking) => {
            const payload = {
              branch_id: branchId,
              client_id: newBooking.clientId,
              service_ids: newBooking.serviceIds,
              check_in: newBooking.checkIn,
              check_out: newBooking.checkOut,
              status: newBooking.status,
            };
            try {
              const { data, error } = await supabase.from("bookings").insert(payload).select().single();
              if (error) throw error;
              setBookings((prev) => [...prev, mapBooking(data)]);
            } catch (e) {
              enqueueAction({ type: "addBooking", payload });
              setPendingCount(queueCount());
              setBookings((prev) => [...prev, { id: "temp-" + Date.now(), branchId, clientId: newBooking.clientId, serviceIds: newBooking.serviceIds, checkIn: newBooking.checkIn, checkOut: newBooking.checkOut, status: newBooking.status }]);
            }
            setShowAddBooking(false);
          }}
        />
      )}

      {/* Add client modal */}
      {showAddClient && (
        <AddClientModal
          onClose={() => setShowAddClient(false)}
          onSave={async (newClient) => {
            const payload = { branch_id: branchId, name: newClient.name, phone: newClient.phone };
            try {
              const { data, error } = await supabase.from("clients").insert(payload).select().single();
              if (error) throw error;
              setClients((prev) => [...prev, mapClient(data)]);
            } catch (e) {
              const tempId = "temp-" + Date.now();
              enqueueAction({ type: "addClient", payload, tempId });
              setPendingCount(queueCount());
              setClients((prev) => [...prev, { id: tempId, branchId, name: newClient.name, phone: newClient.phone }]);
            }
            setShowAddClient(false);
          }}
        />
      )}

      {/* Edit booking modal (owner only) */}
      {editingBooking && (
        <EditBookingModal
          booking={editingBooking}
          clients={bClients}
          services={bServices.filter((s) => s.category !== "Amenities")}
          onClose={() => setEditingBooking(null)}
          onSave={(updates) => saveBookingEdit(editingBooking.id, updates)}
        />
      )}

      {/* Generated guest code modal */}
      {generatedCode && (
        <GeneratedCodeModal
          entry={generatedCode}
          onClose={() => setGeneratedCode(null)}
          onOpenGuest={() => {
            const code = generatedCode.code;
            setGeneratedCode(null);
            onJumpToGuest(code);
          }}
        />
      )}
    </div>
  );
}

function AddClientModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({ name: name.trim(), phone: phone.trim() || "—" });
    setSaving(false);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20
    }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "min(340px, 92vw)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>New client</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Full name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Halima Juma"
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px", boxSizing: "border-box" }}
        />

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Phone number</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. +255 7XX XXX XXX"
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 18px", fontSize: "14px", boxSizing: "border-box" }}
        />

        <button
          disabled={!name.trim() || saving}
          onClick={handleSave}
          style={{
            width: "100%", background: name.trim() ? C.ink : C.line, color: name.trim() ? "#fff" : C.inkSoft,
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: name.trim() && !saving ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            opacity: saving ? 0.7 : 1
          }}
        >
          <Check size={16} /> {saving ? "Saving…" : "Save client"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Edit an existing booking — owner only (both the button that
   opens this and the underlying database write are gated to
   the owner role; staff never see this option).
--------------------------------------------------------- */
function EditBookingModal({ booking, clients, services, onClose, onSave }) {
  const [clientId, setClientId] = useState(booking.clientId);
  const [serviceIds, setServiceIds] = useState(booking.serviceIds);
  const [checkIn, setCheckIn] = useState(booking.checkIn === "TBC" ? "" : booking.checkIn);
  const [checkOut, setCheckOut] = useState(booking.checkOut === "TBC" ? "" : booking.checkOut);
  const [saving, setSaving] = useState(false);

  const toggleService = (id) =>
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  async function handleSave() {
    setSaving(true);
    await onSave({ clientId, serviceIds, checkIn: checkIn || "TBC", checkOut: checkOut || "TBC" });
    setSaving(false);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20
    }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "min(380px, 92vw)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>Edit booking</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Client</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px" }}>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Services</label>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "6px 0 14px" }}>
          {services.map((s) => (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px" }}>
              <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
              {s.name} — {money(s.price)}{s.billingUnit === "per_night" ? "/night" : ""}
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: "10px", marginBottom: "18px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-in</label>
            <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-out</label>
            <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box" }} />
          </div>
        </div>

        <p style={{ fontSize: "11.5px", color: C.inkSoft, margin: "0 0 12px" }}>
          Note: this updates the booking's details only. If the booking already has an invoice, its amount won't change automatically — adjust it in Finance if needed.
        </p>

        <button
          disabled={saving}
          onClick={handleSave}
          style={{
            width: "100%", background: C.ink, color: "#fff",
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: saving ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            opacity: saving ? 0.7 : 1
          }}
        >
          <Check size={16} /> {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function AddBookingModal({ clients, services, onClose, onSave, onAddClient }) {
  const [clientQuery, setClientQuery] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceIds, setServiceIds] = useState([]);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [saving, setSaving] = useState(false);

  const matchedClient = clients.find((c) => c.name.trim().toLowerCase() === clientQuery.trim().toLowerCase());

  function handleQueryChange(value) {
    setClientQuery(value);
    const match = clients.find((c) => c.name.trim().toLowerCase() === value.trim().toLowerCase());
    setPhone(match ? (match.phone === "—" ? "" : match.phone) : "");
  }

  const toggleService = (id) =>
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const canSave = clientQuery.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    let finalClientId;
    if (matchedClient) {
      finalClientId = matchedClient.id;
    } else {
      const created = await onAddClient({ name: clientQuery.trim(), phone: phone.trim() || "—" });
      if (!created) { setSaving(false); return; }
      finalClientId = created.id;
    }
    await onSave({ clientId: finalClientId, serviceIds, checkIn: checkIn || "TBC", checkOut: checkOut || "TBC", status: "pending" });
    setSaving(false);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20
    }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "min(380px, 92vw)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>New booking</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Client name</label>
        <input
          list="client-name-options"
          value={clientQuery}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Start typing a name…"
          autoFocus
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 10px", fontSize: "14px", boxSizing: "border-box" }}
        />
        <datalist id="client-name-options">
          {clients.map((c) => <option key={c.id} value={c.name} />)}
        </datalist>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Phone number</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. +255 7XX XXX XXX"
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 4px", fontSize: "14px", boxSizing: "border-box" }}
        />
        <p style={{ fontSize: "12px", color: C.inkSoft, margin: "0 0 14px" }}>
          {matchedClient ? "Existing client" : clientQuery.trim() ? "New client — will be added" : ""}
        </p>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Services</label>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "6px 0 14px" }}>
          {services.map((s) => (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px" }}>
              <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
              {s.name} — {money(s.price)}{s.billingUnit === "per_night" ? "/night" : ""}
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: "10px", marginBottom: "18px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-in</label>
            <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-out</label>
            <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box" }} />
          </div>
        </div>

        <button
          disabled={!canSave || saving}
          onClick={handleSave}
          style={{
            width: "100%", background: canSave ? C.ink : C.line, color: canSave ? "#fff" : C.inkSoft,
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: canSave && !saving ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            opacity: saving ? 0.7 : 1
          }}
        >
          <Check size={16} /> {saving ? "Saving…" : "Save booking"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Modal shown right after generating a guest access code —
   built for live demos: copy it, or jump straight into the
   guest portal with it already applied.
--------------------------------------------------------- */
/* ---------------------------------------------------------
   Printable invoice — a clean modal that, when printed,
   shows only the invoice itself (everything else on the page
   is hidden via the print stylesheet below).
--------------------------------------------------------- */
function InvoicePrintModal({ data, branch, clientName, serviceNames, services, onClose }) {
  const { invoice, booking } = data;
  const lines = booking ? booking.serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean) : [];
  const nights = booking ? nightsBetween(booking.checkIn, booking.checkOut) : 1;
  const today = new Date().toLocaleDateString([], { dateStyle: "medium" });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30
    }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print-area, #invoice-print-area * { visibility: visible; }
          #invoice-print-area {
            position: fixed; inset: 0; margin: 0; box-shadow: none; border: none;
          }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "0", width: "min(440px, 92vw)", maxHeight: "88vh", overflowY: "auto" }}>
        <div id="invoice-print-area" style={{ padding: "32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
            <div>
              <div className="fr" style={{ fontSize: "20px", fontWeight: 500, color: C.ink }}>Utulivu</div>
              <div style={{ fontSize: "12.5px", color: C.inkSoft }}>{branch?.name}</div>
              <div style={{ fontSize: "12.5px", color: C.inkSoft }}>{branch?.location}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="fr" style={{ fontSize: "16px", fontWeight: 500 }}>Invoice</div>
              <div style={{ fontSize: "12px", color: C.inkSoft }}>{today}</div>
            </div>
          </div>

          <div style={{ fontSize: "13.5px", marginBottom: "20px" }}>
            <div style={{ color: C.inkSoft, fontSize: "12px", marginBottom: "2px" }}>Billed to</div>
            <div style={{ fontWeight: 500 }}>{booking ? clientName(booking.clientId) : "—"}</div>
            {booking && <div style={{ color: C.inkSoft, fontSize: "12.5px" }}>{booking.checkIn} → {booking.checkOut}</div>}
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px", marginBottom: "18px" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.line}`, textAlign: "left", color: C.inkSoft, fontSize: "12px" }}>
                <th style={{ paddingBottom: "8px" }}>Item</th>
                <th style={{ paddingBottom: "8px", textAlign: "right" }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {lines.length > 0 ? lines.map((s) => {
                const qty = s.billingUnit === "per_night" ? nights : 1;
                return (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                    <td style={{ padding: "7px 0" }}>{s.name}{qty > 1 ? ` × ${qty} nights` : ""}</td>
                    <td style={{ padding: "7px 0", textAlign: "right" }}>{money(s.price * qty)}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={2} style={{ padding: "7px 0", color: C.inkSoft }}>{booking ? serviceNames(booking.serviceIds) : "—"}</td></tr>
              )}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "10px", borderTop: `2px solid ${C.ink}` }}>
            <span className="fr" style={{ fontSize: "15px", fontWeight: 500 }}>Total</span>
            <span className="fr" style={{ fontSize: "18px", fontWeight: 500 }}>{money(invoice.amount)}</span>
          </div>
          <div style={{ marginTop: "8px" }}>
            <Pill tone={invoice.status}>{invoice.status}</Pill>
          </div>
        </div>

        <div className="no-print" style={{ display: "flex", gap: "8px", padding: "16px 32px 24px" }}>
          <button
            onClick={() => window.print()}
            style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "none", background: C.ink, color: "#fff", fontSize: "13.5px", cursor: "pointer" }}
          >
            Print
          </button>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "10px", borderRadius: "8px", border: `1px solid ${C.line}`, background: "none", color: C.inkSoft, fontSize: "13.5px", cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function GeneratedCodeModal({ entry, onClose, onOpenGuest }) {
  const [copied, setCopied] = useState(false);
  const expiresLabel = new Date(entry.expires_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  function copy() {
    try {
      navigator.clipboard.writeText(entry.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // clipboard unavailable — the code is still shown on screen
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30
    }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "28px", width: "min(340px, 92vw)", textAlign: "center" }}>
        <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "8px" }}>Guest access code</div>
        <div className="fr" style={{ fontSize: "32px", fontWeight: 500, letterSpacing: "1px", marginBottom: "6px", color: C.ink }}>{entry.code}</div>
        <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "22px" }}>Valid until {expiresLabel}</div>
        <button onClick={copy} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: `1px solid ${C.line}`, background: "none", fontSize: "13.5px", cursor: "pointer", marginBottom: "8px" }}>
          {copied ? "Copied!" : "Copy code"}
        </button>
        <button onClick={onOpenGuest} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "none", background: C.signal, color: "#fff", fontSize: "13.5px", cursor: "pointer", marginBottom: "8px" }}>
          Open guest portal with this code
        </button>
        <button onClick={onClose} style={{ width: "100%", padding: "9px", borderRadius: "8px", border: "none", background: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Operator portal — Utulivu's own view across all subscribers
--------------------------------------------------------- */
function OperatorApp({ onExit }) {
  const [session, setSession] = useState(undefined);
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("subscribers")
      .select("*")
      .then(({ data }) => {
        if (data) setSubscribers(data.map(mapSubscriber));
        setLoading(false);
      });
  }, [session]);

  const totalMrr = subscribers.reduce((sum, p) => sum + p.mrr, 0);
  const activeCount = subscribers.filter((p) => p.subStatus === "active").length;
  const totalBranches = subscribers.reduce((sum, p) => sum + p.branches, 0);

  async function updateTier(id, tier) {
    setSubscribers((prev) => prev.map((p) => (p.id === id ? { ...p, tier } : p)));
    await supabase.from("subscribers").update({ tier }).eq("id", id);
  }

  const subTones = {
    active: { bg: C.signalSoft, fg: "#1E6E67" },
    trial: { bg: "#E4E9F3", fg: "#3A4E8A" },
    overdue: { bg: "#F3DEDE", fg: C.red },
  };

  if (session === undefined) {
    return (
      <div style={{ minHeight: "640px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, color: C.inkSoft }}>
        {FONTS}
        <p className="ws">Loading…</p>
      </div>
    );
  }
  if (!session) return <Login onSignIn={setSession} onBack={onExit} />;
  if (loading) {
    return (
      <div style={{ minHeight: "640px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, color: C.inkSoft }}>
        {FONTS}
        <p className="ws">Loading…</p>
      </div>
    );
  }

  return (
    <div className="ws" style={{ minHeight: "640px", background: C.paper, color: C.ink, padding: isMobile ? "16px" : "28px 32px" }}>
      {FONTS}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Radio size={15} color={C.signal} />
          </div>
          <h1 className="fr" style={{ margin: 0, fontSize: isMobile ? "18px" : "22px", fontWeight: 500 }}>Utulivu · Operator</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {!isMobile && <span style={{ fontSize: "12.5px", color: C.inkSoft }}>{session.user.email}</span>}
          <button onClick={() => supabase.auth.signOut()} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: "7px", padding: "7px 12px", fontSize: "13px", color: C.inkSoft, cursor: "pointer" }}>
            Sign out
          </button>
          {onExit && (
            <button onClick={onExit} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: "7px", padding: "7px 12px", fontSize: "13px", color: C.inkSoft, cursor: "pointer" }}>
              ← Switch portal
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "16px", marginBottom: "20px" }}>
        {[
          ["Monthly recurring revenue", money(totalMrr)],
          ["Active subscribers", activeCount + " / " + subscribers.length],
          ["Branches under management", totalBranches],
        ].map(([label, val]) => (
          <div key={label} style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "10px", padding: "18px" }}>
            <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "8px" }}>{label}</div>
            <div className="fr" style={{ fontSize: "22px", fontWeight: 500 }}>{val}</div>
          </div>
        ))}
      </div>

      <Panel title="Subscribers">
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
          <thead>
            <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
              <th style={{ paddingBottom: "10px" }}>Provider</th>
              <th>Tier</th>
              <th>Branches</th>
              <th>Active bookings</th>
              <th>MRR</th>
              <th>Subscription</th>
            </tr>
          </thead>
          <tbody>
            {subscribers.map((p) => (
              <tr key={p.id} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ padding: "10px 0" }}>{p.name}</td>
                <td>
                  <select
                    value={p.tier}
                    onChange={(e) => updateTier(p.id, e.target.value)}
                    style={{ border: `1px solid ${C.line}`, borderRadius: "6px", padding: "3px 6px", fontSize: "13px" }}
                  >
                    {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td>{p.branches}</td>
                <td>{p.activeBookings}</td>
                <td>{money(p.mrr)}</td>
                <td>
                  <span className="ws" style={{
                    background: subTones[p.subStatus].bg, color: subTones[p.subStatus].fg,
                    fontSize: "12.5px", fontWeight: 500, padding: "3px 10px", borderRadius: "999px"
                  }}>
                    {p.subStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------
   Guest portal — the provider's own client. No account,
   just a temporary access code that expires 1 hour after
   the linked booking's checkout.
--------------------------------------------------------- */
const GUEST_CODE_KEY = "utulivu_guest_code";

function GuestApp({ onExit, initialCode }) {
  const savedCode = (() => {
    try { return localStorage.getItem(GUEST_CODE_KEY); } catch (e) { return null; }
  })();
  const startCode = initialCode || savedCode || "";

  const [codeInput, setCodeInput] = useState(startCode);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(Boolean(startCode));
  const [error, setError] = useState("");
  const [requestSent, setRequestSent] = useState(false);
  const [requestSending, setRequestSending] = useState(false);
  const [airtimeAmount, setAirtimeAmount] = useState("");
  const [airtimeSending, setAirtimeSending] = useState(false);
  const [airtimeSent, setAirtimeSent] = useState(false);
  const [amenities, setAmenities] = useState([]);
  const [amenitiesLoading, setAmenitiesLoading] = useState(false);
  const [requestedIds, setRequestedIds] = useState([]);
  const [sendingId, setSendingId] = useState(null);

  useEffect(() => {
    if (startCode) lookup(startCode, { silent: Boolean(!initialCode && savedCode) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session?.access?.branch_id) return;
    setAmenitiesLoading(true);
    supabase
      .from("services")
      .select("*")
      .eq("branch_id", session.access.branch_id)
      .eq("category", "Amenities")
      .then(({ data }) => {
        if (data) setAmenities(data);
        setAmenitiesLoading(false);
      });
  }, [session]);

  async function requestAmenity(item) {
    setSendingId(item.id);
    await supabase.from("service_requests").insert({
      code: session.access.code,
      guest_name: session.access.guest_name,
      message: `${session.access.guest_name} requested ${item.name} (TSh ${Number(item.price).toLocaleString()})`,
    });
    setSendingId(null);
    setRequestedIds((prev) => [...prev, item.id]);
  }

  async function lookup(rawCode, opts = {}) {
    setLoading(true);
    setError("");
    const { data, error: qErr } = await supabase
      .from("access_codes")
      .select("*")
      .ilike("code", rawCode.trim())
      .maybeSingle();
    setLoading(false);
    if (qErr || !data) {
      try { localStorage.removeItem(GUEST_CODE_KEY); } catch (e) {}
      if (!opts.silent) setError("That access code wasn't recognized. Check the code from your booking confirmation.");
      return;
    }
    const expired = Date.now() > new Date(data.expires_at).getTime();
    if (expired && opts.silent) {
      // Don't silently resurrect an expired stay — send them to the entry screen instead.
      try { localStorage.removeItem(GUEST_CODE_KEY); } catch (e) {}
      return;
    }
    try { localStorage.setItem(GUEST_CODE_KEY, data.code); } catch (e) {}
    setSession({ access: data });
  }

  function enter() {
    lookup(codeInput);
  }

  function switchGuest() {
    try { localStorage.removeItem(GUEST_CODE_KEY); } catch (e) {}
    setSession(null);
    setCodeInput("");
    setError("");
  }

  if (!session) {
    return (
      <div style={{ minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper }}>
        {FONTS}
        <div className="ws" style={{ width: "min(340px, 92vw)", background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "14px", padding: "32px" }}>
          <div style={{ width: "40px", height: "40px", borderRadius: "9px", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "20px" }}>
            <Radio size={19} color={C.signal} />
          </div>
          <h1 className="fr" style={{ margin: "0 0 6px", fontSize: "23px", fontWeight: 500 }}>Your stay</h1>
          <p style={{ margin: "0 0 22px", fontSize: "13.5px", color: C.inkSoft }}>
            Enter the access code from your booking confirmation or from a tap at the property.
          </p>
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="e.g. UTU-2201"
            style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: `1px solid ${C.line}`, marginBottom: "12px", fontSize: "14px", boxSizing: "border-box" }}
          />
          {error && <p style={{ color: C.red, fontSize: "12.5px", margin: "0 0 12px" }}>{error}</p>}
          <button onClick={enter} disabled={loading} style={{ width: "100%", padding: "11px", borderRadius: "8px", border: "none", background: C.ink, color: "#fff", fontSize: "14.5px", fontWeight: 500, cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Checking…" : "Access my stay"}
          </button>
          <p style={{ fontSize: "11.5px", color: C.inkSoft, marginTop: "12px" }}>Try: UTU-2201, UTU-5560, or UTU-0099 (expired demo) — or generate a fresh one from the Provider portal's Bookings tab.</p>
          {onExit && (
            <button onClick={onExit} style={{ width: "100%", marginTop: "10px", padding: "9px", borderRadius: "8px", border: `1px solid ${C.line}`, background: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
              ← Choose a different portal
            </button>
          )}
        </div>
      </div>
    );
  }

  const { access } = session;
  const isExpired = Date.now() > new Date(access.expires_at).getTime();
  const expiresLabel = new Date(access.expires_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="ws" style={{ minHeight: "560px", background: C.paper, display: "flex", justifyContent: "center", padding: "36px 20px" }}>
      {FONTS}
      <div style={{ width: "min(420px, 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
          <h1 className="fr" style={{ margin: 0, fontSize: "22px", fontWeight: 500 }}>Your stay</h1>
          <span style={{
            fontSize: "12.5px", fontWeight: 500, padding: "3px 10px", borderRadius: "999px",
            background: isExpired ? "#F3DEDE" : C.signalSoft, color: isExpired ? C.red : "#1E6E67"
          }}>
            {isExpired ? "Access expired" : "Access active"}
          </span>
        </div>

        {isExpired && (
          <div style={{ background: "#F3DEDE", border: "1px solid #E9C7C7", borderRadius: "9px", padding: "12px 14px", marginBottom: "16px", fontSize: "13px", color: C.red }}>
            This access code expired on {expiresLabel} — one hour after checkout. Contact the front desk if you still need help.
          </div>
        )}

        <Panel title="Booking">
          <div style={{ fontSize: "14px", lineHeight: 1.8 }}>
            <div><strong>{access.service_names}</strong></div>
            <div style={{ color: C.inkSoft }}>{access.check_in} → {access.check_out}</div>
            <div style={{ marginTop: "6px" }}><Pill tone={access.status}>{access.status}</Pill></div>
          </div>
        </Panel>

        <div style={{ height: "14px" }} />

        <Panel title="Invoice">
          {access.invoice_amount != null ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "14px" }}>
              <span>{money(access.invoice_amount)}</span>
              <Pill tone={access.invoice_status}>{access.invoice_status}</Pill>
            </div>
          ) : (
            <span style={{ fontSize: "13.5px", color: C.inkSoft }}>No invoice on file yet.</span>
          )}
        </Panel>

        <div style={{ height: "14px" }} />

        {amenities.length > 0 && (
          <>
            <Panel title="Amenities">
              <p style={{ fontSize: "13px", color: C.inkSoft, marginTop: 0, marginBottom: "14px" }}>
                Tap to request any item — the front desk will bring it to you.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {amenities.map((item) => {
                  const requested = requestedIds.includes(item.id);
                  return (
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
                      <div>
                        <div style={{ fontSize: "13.5px", fontWeight: 500 }}>{item.name}</div>
                        <div style={{ fontSize: "12px", color: C.inkSoft }}>TSh {Number(item.price).toLocaleString()}</div>
                      </div>
                      {requested ? (
                        <span style={{ fontSize: "12.5px", color: "#1E6E67", fontWeight: 500 }}>Requested</span>
                      ) : (
                        <button
                          disabled={isExpired || sendingId === item.id}
                          onClick={() => requestAmenity(item)}
                          style={{
                            fontSize: "12.5px", border: "none", borderRadius: "6px", padding: "6px 12px",
                            background: isExpired ? C.line : C.clay, color: isExpired ? C.inkSoft : "#fff",
                            cursor: isExpired ? "default" : "pointer", opacity: sendingId === item.id ? 0.7 : 1
                          }}
                        >
                          {sendingId === item.id ? "Sending…" : "Request"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
            <div style={{ height: "14px" }} />
          </>
        )}

        <Panel title="Need something?">
          <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: `1px solid ${C.line}` }}>
            <p style={{ fontSize: "13px", fontWeight: 500, margin: "0 0 8px", color: C.ink }}>Airtime top-up</p>
            {airtimeSent ? (
              <p style={{ fontSize: "13.5px", color: "#1E6E67", margin: 0 }}>Request sent for TSh {Number(airtimeAmount).toLocaleString()} — front desk notified.</p>
            ) : (
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="number"
                  min="0"
                  value={airtimeAmount}
                  onChange={(e) => setAirtimeAmount(e.target.value)}
                  placeholder="Amount in TSh"
                  disabled={isExpired || airtimeSending}
                  style={{ flex: 1, padding: "9px 10px", borderRadius: "7px", border: `1px solid ${C.line}`, fontSize: "13.5px", boxSizing: "border-box" }}
                />
                <button
                  disabled={isExpired || airtimeSending || !airtimeAmount || Number(airtimeAmount) <= 0}
                  onClick={async () => {
                    setAirtimeSending(true);
                    await supabase.from("service_requests").insert({
                      code: access.code,
                      guest_name: access.guest_name,
                      message: `${access.guest_name} requested airtime top-up: TSh ${Number(airtimeAmount).toLocaleString()}`,
                    });
                    setAirtimeSending(false);
                    setAirtimeSent(true);
                  }}
                  style={{
                    padding: "9px 14px", borderRadius: "7px", border: "none", fontSize: "13.5px", whiteSpace: "nowrap",
                    background: isExpired ? C.line : C.clay, color: isExpired ? C.inkSoft : "#fff",
                    cursor: isExpired ? "default" : "pointer", opacity: airtimeSending ? 0.7 : 1
                  }}
                >
                  {airtimeSending ? "Sending…" : "Request"}
                </button>
              </div>
            )}
          </div>

          {requestSent ? (
            <p style={{ fontSize: "13.5px", color: "#1E6E67", margin: 0 }}>Request sent — the front desk has been notified.</p>
          ) : (
            <button
              disabled={isExpired || requestSending}
              onClick={async () => {
                setRequestSending(true);
                await supabase.from("service_requests").insert({
                  code: access.code,
                  guest_name: access.guest_name,
                  message: `${access.guest_name} requested assistance (room: ${access.service_names})`,
                });
                setRequestSending(false);
                setRequestSent(true);
              }}
              style={{
                width: "100%", padding: "10px", borderRadius: "8px", border: "none",
                background: isExpired ? C.line : C.signal, color: isExpired ? C.inkSoft : "#fff",
                fontSize: "14px", cursor: isExpired ? "default" : "pointer", opacity: requestSending ? 0.7 : 1
              }}
            >
              {requestSending ? "Sending…" : "Request a service"}
            </button>
          )}
        </Panel>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "18px" }}>
          <button onClick={switchGuest} style={{ background: "none", border: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
            Not you? Switch guest
          </button>
          {onExit && (
            <button onClick={onExit} style={{ background: "none", border: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
              ← Choose a different portal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Portal gate — choose which of the three Utulivu experiences
   to view. In production these are three separate surfaces;
   here they live in one file for the demo.
--------------------------------------------------------- */
function PortalGate({ onSelect, onReset }) {
  const isMobile = useIsMobile();
  const options = [
    { id: "operator", title: "Operator", desc: "Utulivu's own view — manage subscribers, tiers, and platform revenue." },
    { id: "provider", title: "Provider", desc: "The hospitality business's dashboard — bookings, clients, finance, NFC tags." },
    { id: "guest", title: "Guest", desc: "The provider's own client — a temporary, code-based view of their stay." },
  ];
  return (
    <div className="ws" style={{ minHeight: "640px", background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      {FONTS}
      <div style={{ width: "min(620px, 100%)" }}>
        <div style={{ textAlign: "center", marginBottom: "30px" }}>
          <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Radio size={20} color={C.signal} />
          </div>
          <h1 className="fr" style={{ margin: "0 0 6px", fontSize: "28px", fontWeight: 500, color: C.ink }}>Utulivu</h1>
          <p style={{ margin: 0, fontSize: "14px", color: C.inkSoft }}>Choose which portal to view.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "14px" }}>
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => onSelect(o.id)}
              style={{
                textAlign: "left", background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "12px",
                padding: "20px", cursor: "pointer"
              }}
            >
              <div className="fr" style={{ fontSize: "18px", fontWeight: 500, color: C.ink, marginBottom: "8px" }}>{o.title}</div>
              <div style={{ fontSize: "13px", color: C.inkSoft, lineHeight: 1.5 }}>{o.desc}</div>
            </button>
          ))}
        </div>
        {onReset && (
          <div style={{ textAlign: "center", marginTop: "22px" }}>
            <button onClick={onReset} style={{ background: "none", border: "none", color: C.inkSoft, fontSize: "12.5px", cursor: "pointer" }}>
              Reset demo data
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Top-level router
--------------------------------------------------------- */
export default function App() {
  const [portal, setPortal] = useState(null);
  const [prefillGuestCode, setPrefillGuestCode] = useState("");
  const [resetKey, setResetKey] = useState(0);

  async function addAccessCode(entry) {
    const { error } = await supabase.from("access_codes").insert(entry);
    if (error) {
      console.error("Could not save guest access code:", error.message);
      return false;
    }
    return true;
  }

  function jumpToGuest(code) {
    setPrefillGuestCode(code);
    setPortal("guest");
  }

  function resetDemo() {
    setPrefillGuestCode("");
    setPortal(null);
    setResetKey((k) => k + 1); // forces provider/operator to remount with fresh seed state
  }

  if (!portal) return <PortalGate onSelect={setPortal} onReset={resetDemo} />;
  if (portal === "operator") return <OperatorApp key={resetKey} onExit={() => setPortal(null)} />;
  if (portal === "guest") return <GuestApp onExit={() => setPortal(null)} initialCode={prefillGuestCode} />;
  return <ProviderApp key={resetKey} onExit={() => setPortal(null)} onGenerateCode={addAccessCode} onJumpToGuest={jumpToGuest} />;
}
