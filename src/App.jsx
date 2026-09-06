import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import {
  LayoutGrid, CalendarDays, Users, MessageSquareText, Wrench,
  Radio, Wallet, Building2, ChevronDown, Plus, X, Check, Bell
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
   Seed data — one provider, two branches
--------------------------------------------------------- */
const seedBranches = [
  { id: "b1", name: "Kilimani House", location: "Msasani, Dar es Salaam" },
  { id: "b2", name: "Kilimani Beach Annex", location: "Coco Beach, Dar es Salaam" },
];

const seedClients = [
  { id: "c1", branchId: "b1", name: "Amara Ndosi", phone: "+255 754 112 233" },
  { id: "c2", branchId: "b1", name: "James Okoth", phone: "+255 712 445 998" },
  { id: "c3", branchId: "b2", name: "Grace Mwakalinga", phone: "+255 786 220 014" },
];

const seedServices = [
  { id: "s1", branchId: "b1", name: "Deluxe Room", price: 85000, category: "Room" },
  { id: "s2", branchId: "b1", name: "Airport Transfer", price: 25000, category: "Transport" },
  { id: "s3", branchId: "b1", name: "Breakfast", price: 12000, category: "Dining" },
  { id: "s4", branchId: "b2", name: "Beach Bungalow", price: 110000, category: "Room" },
  { id: "s5", branchId: "b2", name: "Sunset Cruise", price: 60000, category: "Excursion" },
];

const seedBookings = [
  { id: "bk1", branchId: "b1", clientId: "c1", serviceIds: ["s1", "s3"], checkIn: "2026-09-04", checkOut: "2026-09-07", status: "confirmed" },
  { id: "bk2", branchId: "b1", clientId: "c2", serviceIds: ["s1", "s2"], checkIn: "2026-09-10", checkOut: "2026-09-12", status: "pending" },
  { id: "bk3", branchId: "b2", clientId: "c3", serviceIds: ["s4", "s5"], checkIn: "2026-09-05", checkOut: "2026-09-09", status: "confirmed" },
];

const seedInquiries = [
  { id: "i1", branchId: "b1", clientId: "c1", message: "Extra towels for room 4", status: "new" },
  { id: "i2", branchId: "b1", clientId: "c2", message: "Late checkout request", status: "quoted" },
  { id: "i3", branchId: "b2", clientId: "c3", message: "Vegetarian dinner option", status: "completed" },
];

const seedTags = [
  { id: "t1", branchId: "b1", label: "Room 4 door", type: "Room", linkedName: "Deluxe Room · Amara Ndosi", lastScan: null },
  { id: "t2", branchId: "b1", label: "Reception desk", type: "Service request", linkedName: "Front desk inquiry line", lastScan: null },
  { id: "t3", branchId: "b2", label: "Bungalow 2 door", type: "Room", linkedName: "Beach Bungalow · Grace Mwakalinga", lastScan: null },
];

const seedInvoices = [
  { id: "v1", branchId: "b1", bookingId: "bk1", amount: 291000, status: "paid" },
  { id: "v2", branchId: "b1", bookingId: "bk2", amount: 195000, status: "outstanding" },
  { id: "v3", branchId: "b2", bookingId: "bk3", amount: 500000, status: "outstanding" },
];

/* Operator-portal seed data — Utulivu's own subscriber book */
const seedSubscribers = [
  { id: "p1", name: "Kilimani House Hospitality", tier: "Growth", branches: 2, activeBookings: 3, subStatus: "active", mrr: 180000 },
  { id: "p2", name: "Serengeti Trails Lodge", tier: "Full Suite", branches: 4, activeBookings: 11, subStatus: "active", mrr: 420000 },
  { id: "p3", name: "Zanzibar Tide Rooms", tier: "Essentials", branches: 1, activeBookings: 2, subStatus: "trial", mrr: 60000 },
  { id: "p4", name: "Arusha Peak Retreat", tier: "Growth", branches: 2, activeBookings: 0, subStatus: "overdue", mrr: 180000 },
];
const TIER_OPTIONS = ["Essentials", "Growth", "Full Suite"];

/* Guest access codes now live in Supabase (table: access_codes) —
   see src/supabaseClient.js. This makes a code generated on one
   device actually work when a guest enters it on a different device. */

const INQUIRY_STAGES = ["new", "quoted", "confirmed", "completed"];
const money = (n) => "TSh " + n.toLocaleString();


/* ---------------------------------------------------------
   Small building blocks
--------------------------------------------------------- */
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
  const [name, setName] = useState("Kilimani House Hospitality");
  return (
    <div style={{
      minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center",
      background: C.paper
    }}>
      {FONTS}
      <div style={{
        width: "360px", background: C.paperRaised, border: `1px solid ${C.line}`,
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
          Hospitality operations, in one dashboard.
        </p>
        <label className="ws" style={{ fontSize: "12.5px", color: C.inkSoft, display: "block", marginBottom: "6px" }}>
          Provider account
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="ws"
          style={{
            width: "100%", padding: "10px 12px", borderRadius: "8px",
            border: `1px solid ${C.line}`, marginBottom: "18px", fontSize: "14px",
            outlineColor: C.signal, boxSizing: "border-box"
          }}
        />
        <button
          onClick={() => onSignIn(name)}
          className="ws"
          style={{
            width: "100%", padding: "11px", borderRadius: "8px", border: "none",
            background: C.ink, color: "#fff", fontSize: "14.5px", fontWeight: 500, cursor: "pointer"
          }}
        >
          Sign in to demo
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
  const [providerName, setProviderName] = useState(null);
  const [branches] = useState(seedBranches);
  const [branchId, setBranchId] = useState(seedBranches[0].id);
  const [tab, setTab] = useState("dashboard");

  const [clients, setClients] = useState(seedClients);
  const [services] = useState(seedServices);
  const [bookings, setBookings] = useState(seedBookings);
  const [inquiries, setInquiries] = useState(seedInquiries);
  const [tags, setTags] = useState(seedTags);
  const [invoices] = useState(seedInvoices);

  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [showAddBooking, setShowAddBooking] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [tapFlash, setTapFlash] = useState(null);
  const [generatedCode, setGeneratedCode] = useState(null);
  const [generatingId, setGeneratingId] = useState(null);
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    if (!providerName) return;

    supabase
      .from("service_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setRequests(data);
      });

    const channel = supabase
      .channel("service_requests_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "service_requests" }, (payload) => {
        setRequests((prev) => [payload.new, ...prev]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "service_requests" }, (payload) => {
        setRequests((prev) => prev.map((r) => (r.id === payload.new.id ? payload.new : r)));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerName]);

  async function markRequestHandled(id) {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "handled" } : r)));
    await supabase.from("service_requests").update({ status: "handled" }).eq("id", id);
  }

  if (!providerName) return <Login onSignIn={setProviderName} onBack={onExit} />;

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

  function simulateTap(tagId) {
    const tag = tags.find((t) => t.id === tagId);
    if (!tag) return;
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setTags((prev) => prev.map((t) => (t.id === tagId ? { ...t, lastScan: stamp } : t)));
    setTapFlash(tagId);
    setTimeout(() => setTapFlash(null), 1000);
    if (tag.type === "Service request") {
      setInquiries((prev) => [
        { id: "i" + Date.now(), branchId: tag.branchId, clientId: bClients[0]?.id || "c1", message: "Tap request from " + tag.label, status: "new" },
        ...prev,
      ]);
    }
  }

  function moveInquiry(id, dir) {
    setInquiries((prev) =>
      prev.map((iq) => {
        if (iq.id !== id) return iq;
        const idx = INQUIRY_STAGES.indexOf(iq.status);
        const next = INQUIRY_STAGES[Math.min(Math.max(idx + dir, 0), INQUIRY_STAGES.length - 1)];
        return { ...iq, status: next };
      })
    );
  }

  function updateBookingStatus(id, status) {
    setBookings((prev) => prev.map((bk) => (bk.id === id ? { ...bk, status } : bk)));
  }

  async function generateGuestCode(bk) {
    setGeneratingId(bk.id);
    const code = "UTU-" + Math.floor(1000 + Math.random() * 9000);
    const checkoutDate = bk.checkOut && bk.checkOut !== "TBC" ? bk.checkOut : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const expiresAt = `${checkoutDate}T12:00:00`;
    const inv = invoices.find((v) => v.bookingId === bk.id);
    const entry = {
      code,
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
    <div className="ws" style={{ display: "flex", minHeight: "640px", background: C.paper, color: C.ink }}>
      {FONTS}

      {/* Sidebar */}
      <div style={{ width: "220px", background: C.ink, padding: "20px 14px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "0 6px 20px" }}>
          <div style={{ width: "26px", height: "26px", borderRadius: "7px", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Radio size={14} color={C.signal} />
          </div>
          <span className="fr" style={{ color: "#fff", fontSize: "16px", fontWeight: 500 }}>Utulivu</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {NAV.map((n) => (
            <NavItem key={n.id} icon={n.icon} label={n.label} active={tab === n.id} onClick={() => setTab(n.id)} badge={n.badge} />
          ))}
        </div>
        <div style={{ marginTop: "auto", padding: "12px 6px 0", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px", margin: "12px 0 6px" }}>{providerName}</p>
          {onExit && (
            <button onClick={onExit} className="ws" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", fontSize: "12px", cursor: "pointer", padding: 0 }}>
              ← Switch portal
            </button>
          )}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top bar */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 28px", borderBottom: `1px solid ${C.line}`, position: "relative"
        }}>
          <div>
            <h2 className="fr" style={{ margin: 0, fontSize: "21px", fontWeight: 500, textTransform: "capitalize" }}>
              {tab === "tags" ? "NFC tags" : tab}
            </h2>
          </div>
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

        {/* Content */}
        <div style={{ padding: "24px 28px", overflowY: "auto", flex: 1 }}>

          {tab === "dashboard" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
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
              <div style={{ gridColumn: "span 4" }}>
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
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
                    <th style={{ paddingBottom: "10px" }}>Client</th>
                    <th>Services</th>
                    <th>Dates</th>
                    <th>Status</th>
                    <th>Guest access</th>
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
                    </tr>
                  ))}
                </tbody>
              </table>
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
                {bClients.map((c) => (
                  <div key={c.id} style={{ border: `1px solid ${C.line}`, borderRadius: "9px", padding: "14px" }}>
                    <div style={{ fontWeight: 500, marginBottom: "4px" }}>{c.name}</div>
                    <div style={{ fontSize: "13px", color: C.inkSoft }}>{c.phone}</div>
                  </div>
                ))}
                {bClients.length === 0 && (
                  <div style={{ fontSize: "13.5px", color: C.inkSoft }}>No clients yet for this branch.</div>
                )}
              </div>
            </Panel>
          )}

          {tab === "inquiries" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" }}>
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
                      <td>{money(s.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {tab === "tags" && (
            <Panel title="NFC tags">
              <p style={{ fontSize: "13.5px", color: C.inkSoft, marginTop: 0, marginBottom: "18px" }}>
                Tap a tag below to simulate a guest or staff scan — a room tag logs a scan, a service-request tag opens a new inquiry.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
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
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
                      <th style={{ paddingBottom: "10px" }}>Booking</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bInvoices.map((v) => {
                      const bk = bookings.find((b) => b.id === v.bookingId);
                      return (
                        <tr key={v.id} style={{ borderTop: `1px solid ${C.line}` }}>
                          <td style={{ padding: "10px 0" }}>{bk ? clientName(bk.clientId) : "—"}</td>
                          <td>{money(v.amount)}</td>
                          <td><Pill tone={v.status}>{v.status}</Pill></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Panel>
            </div>
          )}
        </div>
      </div>

      {/* Add booking modal */}
      {showAddBooking && (
        <AddBookingModal
          clients={bClients}
          services={bServices}
          onClose={() => setShowAddBooking(false)}
          onAddClient={(newClient) => {
            const client = { ...newClient, id: "c" + Date.now(), branchId };
            setClients((prev) => [...prev, client]);
            return client;
          }}
          onSave={(newBooking) => {
            setBookings((prev) => [...prev, { ...newBooking, id: "bk" + Date.now(), branchId }]);
            setShowAddBooking(false);
          }}
        />
      )}

      {/* Add client modal */}
      {showAddClient && (
        <AddClientModal
          onClose={() => setShowAddClient(false)}
          onSave={(newClient) => {
            setClients((prev) => [...prev, { ...newClient, id: "c" + Date.now(), branchId }]);
            setShowAddClient(false);
          }}
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

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20
    }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "340px" }}>
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
          disabled={!name.trim()}
          onClick={() => onSave({ name: name.trim(), phone: phone.trim() || "—" })}
          style={{
            width: "100%", background: name.trim() ? C.ink : C.line, color: name.trim() ? "#fff" : C.inkSoft,
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: name.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
          }}
        >
          <Check size={16} /> Save client
        </button>
      </div>
    </div>
  );
}

function AddBookingModal({ clients, services, onClose, onSave, onAddClient }) {
  const [clientId, setClientId] = useState(clients[0]?.id || "__new__");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [serviceIds, setServiceIds] = useState([]);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");

  const toggleService = (id) =>
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const isNewClient = clientId === "__new__";
  const canSave = isNewClient ? newName.trim().length > 0 : Boolean(clientId);

  function handleSave() {
    let finalClientId = clientId;
    if (isNewClient) {
      const created = onAddClient({ name: newName.trim(), phone: newPhone.trim() || "—" });
      finalClientId = created.id;
    }
    onSave({ clientId: finalClientId, serviceIds, checkIn: checkIn || "TBC", checkOut: checkOut || "TBC", status: "pending" });
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20
    }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "380px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>New booking</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Client</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px" }}>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="__new__">+ New client…</option>
        </select>

        {isNewClient && (
          <div style={{ border: `1px dashed ${C.line}`, borderRadius: "8px", padding: "12px", marginBottom: "14px" }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Full name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Halima Juma"
              style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 10px", fontSize: "13.5px", boxSizing: "border-box" }}
            />
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Phone number</label>
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="e.g. +255 7XX XXX XXX"
              style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 0", fontSize: "13.5px", boxSizing: "border-box" }}
            />
          </div>
        )}

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Services</label>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "6px 0 14px" }}>
          {services.map((s) => (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px" }}>
              <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
              {s.name} — {money(s.price)}
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
          disabled={!canSave}
          onClick={handleSave}
          style={{
            width: "100%", background: canSave ? C.ink : C.line, color: canSave ? "#fff" : C.inkSoft,
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: canSave ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
          }}
        >
          <Check size={16} /> Save booking
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
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "28px", width: "340px", textAlign: "center" }}>
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
  const [subscribers, setSubscribers] = useState(seedSubscribers);

  const totalMrr = subscribers.reduce((sum, p) => sum + p.mrr, 0);
  const activeCount = subscribers.filter((p) => p.subStatus === "active").length;
  const totalBranches = subscribers.reduce((sum, p) => sum + p.branches, 0);

  function updateTier(id, tier) {
    setSubscribers((prev) => prev.map((p) => (p.id === id ? { ...p, tier } : p)));
  }

  const subTones = {
    active: { bg: C.signalSoft, fg: "#1E6E67" },
    trial: { bg: "#E4E9F3", fg: "#3A4E8A" },
    overdue: { bg: "#F3DEDE", fg: C.red },
  };

  return (
    <div className="ws" style={{ minHeight: "640px", background: C.paper, color: C.ink, padding: "28px 32px" }}>
      {FONTS}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Radio size={15} color={C.signal} />
          </div>
          <h1 className="fr" style={{ margin: 0, fontSize: "22px", fontWeight: 500 }}>Utulivu · Operator</h1>
        </div>
        {onExit && (
          <button onClick={onExit} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: "7px", padding: "7px 12px", fontSize: "13px", color: C.inkSoft, cursor: "pointer" }}>
            ← Switch portal
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "20px" }}>
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
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------
   Guest portal — the provider's own client. No account,
   just a temporary access code that expires 1 hour after
   the linked booking's checkout.
--------------------------------------------------------- */
function GuestApp({ onExit, initialCode }) {
  const [codeInput, setCodeInput] = useState(initialCode || "");
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(Boolean(initialCode));
  const [error, setError] = useState("");
  const [requestSent, setRequestSent] = useState(false);
  const [requestSending, setRequestSending] = useState(false);

  useEffect(() => {
    if (initialCode) lookup(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(rawCode) {
    setLoading(true);
    setError("");
    const { data, error: qErr } = await supabase
      .from("access_codes")
      .select("*")
      .ilike("code", rawCode.trim())
      .maybeSingle();
    setLoading(false);
    if (qErr || !data) {
      setError("That access code wasn't recognized. Check the code from your booking confirmation.");
      return;
    }
    setSession({ access: data });
  }

  function enter() {
    lookup(codeInput);
  }

  if (!session) {
    return (
      <div style={{ minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper }}>
        {FONTS}
        <div className="ws" style={{ width: "340px", background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "14px", padding: "32px" }}>
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
      <div style={{ width: "420px" }}>
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

        <Panel title="Need something?">
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

        {onExit && (
          <button onClick={onExit} style={{ marginTop: "18px", background: "none", border: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
            ← Choose a different portal
          </button>
        )}
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
  const options = [
    { id: "operator", title: "Operator", desc: "Utulivu's own view — manage subscribers, tiers, and platform revenue." },
    { id: "provider", title: "Provider", desc: "The hospitality business's dashboard — bookings, clients, finance, NFC tags." },
    { id: "guest", title: "Guest", desc: "The provider's own client — a temporary, code-based view of their stay." },
  ];
  return (
    <div className="ws" style={{ minHeight: "640px", background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      {FONTS}
      <div style={{ width: "620px" }}>
        <div style={{ textAlign: "center", marginBottom: "30px" }}>
          <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Radio size={20} color={C.signal} />
          </div>
          <h1 className="fr" style={{ margin: "0 0 6px", fontSize: "28px", fontWeight: 500, color: C.ink }}>Utulivu</h1>
          <p style={{ margin: 0, fontSize: "14px", color: C.inkSoft }}>Choose which portal to view.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
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
