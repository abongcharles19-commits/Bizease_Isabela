import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

// Keep the API on the same hostname as the dashboard so PHP session cookies
// work when the dashboard is opened through either localhost or 127.0.0.1.
const API_URL = `${window.location.protocol}//${window.location.hostname}/barangay_bungahin/api/index.php`;

const navItems = [
  ["Overview", "▦"],
  ["Residents", "♙"],
  ["Households", "⌂"],
  ["Certificate Requests", "▤"],
  ["Announcements & SMS", "▰"],
  ["Documents", "\u25a4"],
];
async function apiCall(resource, { method = "GET", id, body: payload } = {}) {
  const params = new URLSearchParams({ resource });
  if (id) params.set("id", id);
  const response = await fetch(`${API_URL}?${params}`, {
    method,
    credentials: "include",
    headers: payload && !(payload instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    body: payload ? (payload instanceof FormData ? payload : JSON.stringify(payload)) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error || "The server could not complete this request.",
    );
  return result;
}

function BrandLogo({ className = "" }) {
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src="/barangay-bungahin-logo.png"
      alt="Barangay Bungahin logo"
      width="48"
      height="48"
    />
  );
}

function App() {
  const [auth, setAuth] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  useEffect(() => {
    fetch(`${API_URL}?resource=auth`, { credentials: "include" })
      .then(async (response) =>
        response.ok ? (await response.json()).user : null,
      )
      .then((user) => setAuth(user))
      .catch(() => setAuth(null))
      .finally(() => setAuthLoading(false));
  }, []);
  const login = async (credentials) => {
    setAuthError("");
    try {
      const response = await fetch(`${API_URL}?resource=auth`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", ...credentials }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to sign in.");
      setDataLoading(true);
      setAuth(result.user);
    } catch (error) {
      setAuthError(
        error.message ||
          "Cannot reach the server. Check that XAMPP Apache and MySQL are running.",
      );
    }
  };
  const logout = async () => {
    try {
      await fetch(`${API_URL}?resource=auth`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } finally {
      setAuth(null);
      setPageState("Overview");
    }
  };
  const [page, setPageState] = useState("Overview");
  const [residents, setResidents] = useState([]);
  const [requests, setRequests] = useState([]);
  const [notices, setNotices] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState("");
  const [selected, setSelected] = useState(null);
  const [printRequest, setPrintRequest] = useState(null);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [residentForm, setResidentForm] = useState({
    name: "",
    email: "",
    password: "",
    household: "",
    purok: "Purok 1",
    birth_date: "",
    phone: "",
    sms_opt_in: false,
  });
  const [noticeForm, setNoticeForm] = useState({
    title: "",
    text: "",
    audience: "All residents",
  });
  const [documentForm, setDocumentForm] = useState({
    title: "",
    document_type: "Policy",
    description: "",
    status: "implemented",
    document_date: new Date().toISOString().slice(0, 10),
    file: null,
  });
  const [requestForm, setRequestForm] = useState({
    resident: "",
    type: "Barangay Clearance",
    purpose: "",
  });
  const filtered = useMemo(
    () =>
      residents.filter((r) =>
        `${r.name} ${r.id} ${r.purok}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [residents, search],
  );
  const announce = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }, []);
  const authRole = auth?.role;
  const refreshData = useCallback(async () => {
    const resources = ["residents", "requests", "announcements"];
    if (authRole === "admin") resources.push("documents");
    const results = await Promise.allSettled(resources.map((resource) => apiCall(resource)));
    const failures = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failures.push(`${resources[index]}: ${result.reason.message}`);
        return;
      }
      const data = result.value.data;
      if (resources[index] === "residents") setResidents(data);
      if (resources[index] === "requests") setRequests(data);
      if (resources[index] === "announcements") setNotices(data);
      if (resources[index] === "documents") setDocuments(data);
    });
    if (failures.length) announce(`Some records could not load: ${failures.join("; ")}`);
    else announce("Records refreshed from MySQL");
  }, [authRole, announce]);
  useEffect(() => {
    if (!auth) return;
    const resources = ["residents", "requests", "announcements"];
    if (auth.role === "admin") resources.push("documents");
    Promise.allSettled(resources.map((resource) => apiCall(resource)))
      .then((results) => {
        const failures = [];
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            failures.push(`${resources[index]}: ${result.reason.message}`);
            return;
          }
          const data = result.value.data;
          if (resources[index] === "residents") setResidents(data);
          if (resources[index] === "requests") setRequests(data);
          if (resources[index] === "announcements") setNotices(data);
          if (resources[index] === "documents") setDocuments(data);
        });
        if (failures.length) announce(`Some records could not load: ${failures.join("; ")}`);
      })
      .finally(() => setDataLoading(false));
  }, [auth, announce]);
  const runAction = async (action, successMessage) => {
    try {
      const result = await action();
      await refreshData();
      announce(successMessage);
      return result;
    } catch (error) {
      announce(error.message || "Could not save to MySQL");
      return null;
    }
  };
  const openResident = (resident = null) => {
    setSelected(resident);
    setResidentForm(
      resident
        ? { ...resident, password: "", sms_opt_in: Boolean(Number(resident.sms_opt_in)) }
        : {
            name: "",
            email: "",
            password: "",
            household: "",
            purok: "Purok 1",
            birth_date: "",
            phone: "",
            sms_opt_in: false,
          },
    );
    setModal("resident");
  };
  const submitResident = async (e) => {
    e.preventDefault();
    const parts = residentForm.name.trim().split(/\s+/);
    const payload = {
      first_name: parts[0],
      middle_name: parts.length > 2 ? parts.slice(1, -1).join(" ") : null,
      last_name: parts.length > 1 ? parts.at(-1) : parts[0],
      household: residentForm.household,
      purok: residentForm.purok,
      birth_date: residentForm.birth_date || null,
      phone: residentForm.phone,
      sms_opt_in: residentForm.sms_opt_in ? 1 : 0,
      ...(!selected || ["admin", "secretary", "staff"].includes(auth.role) ? { email: residentForm.email, password: residentForm.password } : {}),
    };
    const saved = await runAction(
      () =>
        apiCall("residents", {
          method: selected ? "PATCH" : "POST",
          id: selected?.db_id,
          body: payload,
        }),
      selected
        ? "Resident details and login updated"
        : "Resident registered with a login account",
    );
    if (saved) {
      setModal("");
      if (!selected) setResidentForm({ name: "", email: "", password: "", household: "", purok: "Purok 1", birth_date: "", phone: "", sms_opt_in: false });
    }
  };
  const submitNotice = async (e) => {
    e.preventDefault();
    const audience = noticeForm.audience === "All residents" ? "all" : "purok";
    const result = await runAction(
      () =>
        apiCall("announcements", {
          method: "POST",
          body: {
            title: noticeForm.title,
            message: noticeForm.text,
            audience,
            audience_purok: audience === "purok" ? noticeForm.audience : null,
          },
        }),
      "Announcement saved to MySQL",
    );
    if (!result) return;
    setModal("");
    setNoticeForm({ title: "", text: "", audience: "All residents" });
    const count = Number(result.accepted || result.queued || 0);
    const resultMessage = result.provider === "textbee"
      ? `TextBee accepted ${count} SMS message${count === 1 ? "" : "s"}; delivery is pending`
      : result.provider === "error"
        ? `Announcement saved; TextBee could not accept the SMS batch${result.provider_error ? `: ${result.provider_error}` : ""}`
        : `Announcement saved; ${result.queued} opted-in SMS message${result.queued === 1 ? "" : "s"} queued until TextBee is configured`;
    announce(result.invalid ? `${resultMessage}. ${result.invalid} invalid phone number${result.invalid === 1 ? "" : "s"} skipped.` : resultMessage);
  };
  const submitRequest = async (e) => {
    e.preventDefault();
    const resident = residents.find((r) => r.name === requestForm.resident);
    if (!resident) {
      announce("Choose a resident registered in the database");
      return;
    }
    const saved = await runAction(
      () =>
        apiCall("requests", {
          method: "POST",
          body: {
            resident_id: resident.db_id,
            document_type: requestForm.type,
            purpose: requestForm.purpose,
          },
        }),
      "Certificate request saved to MySQL",
    );
    if (saved) setModal("");
  };
  const submitDocument = async (e) => {
    e.preventDefault();
    const payload = new FormData();
    Object.entries(documentForm).forEach(([key, value]) => {
      if (value !== null && value !== "") payload.append(key, value);
    });
    const saved = await runAction(
      () => apiCall("documents", { method: "POST", body: payload }),
      "Document added to the register",
    );
    if (saved) {
      setModal("");
      setDocumentForm({ title: "", document_type: "Policy", description: "", status: "implemented", document_date: new Date().toISOString().slice(0, 10), file: null });
    }
  };
  const downloadDocument = async (document) => {
    try {
      const response = await fetch(`${API_URL}?resource=document-file&id=${document.id}`, { credentials: "include" });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Could not download this document.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.original_file_name || document.title;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      announce(error.message || "Could not download this document.");
    }
  };
  const createResidentRequest = async (payload) => {
    const result = await apiCall("requests", { method: "POST", body: payload });
    await refreshData();
    return result;
  };
  const saveResidentPreferences = async (payload) => {
    const result = await apiCall("residents", {
      method: "PATCH",
      id: auth.resident_id,
      body: payload,
    });
    await refreshData();
    return result;
  };
  const updateStatus = async (id, status) => {
    const request = requests.find((item) => item.id === id);
    try {
      const result = await apiCall("requests", {
        method: "PATCH",
        id: request?.db_id,
        body: { status },
      });
      await refreshData();
      if (result.changed) announce(result.notification?.message || `Request marked ${status.toLowerCase()}`);
      return result;
    } catch (error) {
      announce(error.message || "Could not update the certificate request.");
      return null;
    }
  };
  const updatePickupDate = async (id, pickupDate) => {
    const request = requests.find((item) => item.id === id);
    try {
      await apiCall("requests", {
        method: "PATCH",
        id: request?.db_id,
        body: { estimated_pickup_date: pickupDate || null },
      });
      await refreshData();
      announce(pickupDate ? "Estimated pickup date saved" : "Estimated pickup date cleared");
    } catch (error) {
      announce(error.message || "Could not save the estimated pickup date.");
    }
  };
  const setPage = (name) => {
    setPageState(name);
    setMobileNav(false);
  };

  if (authLoading || (auth && dataLoading))
    return (
      <div className="auth-loading">
        <BrandLogo className="loading-logo" />
        <p>
          {authLoading ? "Checking your session…" : "Loading barangay records…"}
        </p>
      </div>
    );
  if (!auth) return <LoginPage onLogin={login} error={authError} />;
  if (auth.role === "resident")
    return (
      <ResidentPortal
        user={auth}
        resident={residents.find((item) => Number(item.db_id) === Number(auth.resident_id))}
        requests={requests}
        notices={notices}
        onRequest={createResidentRequest}
        onSavePreferences={saveResidentPreferences}
        onRefresh={refreshData}
        onLogout={logout}
      />
    );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <BrandLogo />
          <div>
            <strong>Barangay Bungahin</strong>
            <span>INFORMATION SYSTEM</span>
          </div>
        </div>
        <div className="nav-label">MAIN MENU</div>
        <nav>
          {navItems.filter(([name]) => name !== "Documents" || auth.role === "admin").map(([name, icon]) => (
            <button
              key={name}
              className={`nav-link ${page === name ? "active" : ""}`}
              onClick={() => setPage(name)}
            >
              <span className="nav-icon">{icon}</span>
              {name}
              {name === "Certificate Requests" && (
                <b className="nav-count">
                  {requests.filter((r) => r.status === "Pending").length}
                </b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-icon">✦</span>
            <strong>Need assistance?</strong>
            <p>Contact the barangay administrator for help.</p>
            <button
              onClick={() => announce("Barangay office · (034) 555-0182")}
            >
              Contact office <span>↗</span>
            </button>
          </div>
          <div className="user-card">
            <div className="avatar">
              {auth.full_name
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
            <div>
              <strong>{auth.full_name}</strong>
              <span>{auth.role[0].toUpperCase() + auth.role.slice(1)}</span>
            </div>
            <button title="Log out" onClick={logout}>
              ↪
            </button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button
            className="menu-toggle"
            onClick={() => setMobileNav(!mobileNav)}
          >
            ☰
          </button>
          <div className="breadcrumb">
            Barangay Bungahin <span>/</span> <b>{page}</b>
          </div>
          <div className="top-actions">
            <button className="outline-button top-logout" onClick={refreshData} title="Reload records from the database">
              Refresh records
            </button>
            <span className="date-label">
              ◷ &nbsp;
              {new Date().toLocaleDateString("en-PH", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <button
              className="icon-button notification"
              title="Notifications"
              onClick={() => setPage("Certificate Requests")}
            >
              ♧<i />
            </button>
            <div className="top-avatar">
              {auth.full_name
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
            <button className="outline-button top-logout" onClick={logout}>
              Log out
            </button>
          </div>
        </header>
        <div className="content">
          {page === "Overview" && (
            <>
              <div className="welcome-row">
                <div>
                  <div className="eyebrow">
                    STAFF DASHBOARD ·{" "}
                    {new Date()
                      .toLocaleDateString("en-PH", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                      .toUpperCase()}
                  </div>
                  <h1>
                    Welcome, {auth.full_name.split(" ")[0]} <span>✦</span>
                  </h1>
                  <p>Here’s what’s happening in your barangay today.</p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => openResident()}
                >
                  <span>＋</span> Add resident
                </button>
              </div>
              <section className="stat-grid">
                <Stat
                  label="Total residents"
                  value={residents.length.toLocaleString()}
                  change="Registered in the barangay"
                  icon="♙"
                  color="blue"
                />
                <Stat
                  label="Households"
                  value={new Set(
                    residents.map((r) => r.household),
                  ).size.toLocaleString()}
                  change="Across 4 puroks"
                  icon="⌂"
                  color="purple"
                />
                <Stat
                  label="Pending requests"
                  value={requests
                    .filter((r) => ["Pending", "Processing"].includes(r.status))
                    .length.toString()
                    .padStart(2, "0")}
                  change="Needs your attention"
                  icon="▤"
                  color="orange"
                />
                <Stat
                  label="SMS notifications"
                  value={notices
                    .reduce((n, item) => n + item.sent, 0)
                    .toLocaleString()}
                  change="Recipients reached"
                  icon="▰"
                  color="green"
                />
              </section>
              <div className="dashboard-grid">
                <section className="panel requests-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Recent certificate requests</h2>
                      <p>Review and manage resident applications</p>
                    </div>
                    <button
                      className="text-link"
                      onClick={() => setPage("Certificate Requests")}
                    >
                      View all <span>→</span>
                    </button>
                  </div>
                  <div className="table-wrap">
                    <RequestTable
                      requests={requests.slice(0, 4)}
                      onStatus={updateStatus}
                      onPickupDate={updatePickupDate}
                    />
                  </div>
                </section>
                <section className="panel quick-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Quick actions</h2>
                      <p>Common tasks, right at your fingertips</p>
                    </div>
                  </div>
                  <div className="quick-actions">
                    <button onClick={() => openResident()}>
                      <i className="qa blue">♙</i>
                      <span>
                        <b>Register a resident</b>
                        <small>Add a new resident record</small>
                      </span>
                      <em>→</em>
                    </button>
                    <button
                      onClick={() => {
                        setRequestForm({
                          resident: "",
                          type: "Barangay Clearance",
                          purpose: "",
                        });
                        setModal("request");
                      }}
                    >
                      <i className="qa purple">▤</i>
                      <span>
                        <b>New certificate request</b>
                        <small>Record a walk-in application</small>
                      </span>
                      <em>→</em>
                    </button>
                    <button onClick={() => setModal("notice")}>
                      <i className="qa green">▰</i>
                      <span>
                        <b>Send an announcement</b>
                        <small>Notify residents by SMS</small>
                      </span>
                      <em>→</em>
                    </button>
                  </div>
                </section>
              </div>
              <div className="lower-grid">
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Recent activity</h2>
                      <p>The latest updates from your barangay</p>
                    </div>
                    <button
                      className="more-button"
                      onClick={() => announce("Showing the latest activity")}
                    >
                      •••
                    </button>
                  </div>
                  <div className="activity-list">
                    <Activity
                      icon="♙"
                      tone="blue"
                      title="New resident registered"
                      detail="Catherine Flores · Purok 4"
                      time="12 minutes ago"
                    />
                    <Activity
                      icon="▤"
                      tone="orange"
                      title="Certificate ready for pickup"
                      detail="Angela Mae Reyes · Residency"
                      time="1 hour ago"
                    />
                    <Activity
                      icon="▰"
                      tone="green"
                      title="SMS announcement sent"
                      detail="Free Health Check-up · 1,248 recipients"
                      time="Yesterday"
                    />
                  </div>
                </section>
                <section className="panel announcement-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Latest announcement</h2>
                      <p>Most recent community update</p>
                    </div>
                    <span className="live-dot">LIVE</span>
                  </div>
                  {notices[0] ? (
                    <div className="announcement-card">
                      <div className="notice-icon">▰</div>
                      <div>
                        <h3>{notices[0].title}</h3>
                        <p>{notices[0].text}</p>
                        <div className="notice-meta">
                          <span>◷ {notices[0].date}</span>
                          <span>
                            ♙ {notices[0].sent.toLocaleString()} notified
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Empty text="No announcements yet" />
                  )}
                  <button
                    className="outline-button"
                    onClick={() => setPage("Announcements & SMS")}
                  >
                    View all announcements <span>→</span>
                  </button>
                </section>
              </div>
            </>
          )}
          {page === "Residents" && (
            <>
              <PageHeading
                eyebrow="COMMUNITY DIRECTORY"
                title="Residents"
                subtitle="Manage resident profiles and household information."
                action={
                  <button
                    className="primary-button"
                    onClick={() => openResident()}
                  >
                    ＋ Add resident
                  </button>
                }
              />
              <section className="panel directory-panel">
                <div className="table-toolbar">
                  <div className="search-box">
                    ⌕{" "}
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name, ID, or purok..."
                    />
                  </div>
                  <button
                    className="filter-button"
                    onClick={() =>
                      announce(`Showing ${residents.length} resident records`)
                    }
                  >
                    ☷ &nbsp;All residents⌄
                  </button>
                  <span className="record-count">
                    {filtered.length} residents
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>RESIDENT</th>
                        <th>RESIDENT ID</th>
                        <th>HOUSEHOLD</th>
                        <th>PUROK</th>
                        <th>AGE</th>
                        <th>CONTACT NUMBER</th>
                        <th>STATUS</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r, i) => (
                        <tr key={r.id}>
                          <td>
                            <div className="resident-cell">
                              <div className={`mini-avatar tone-${i % 4}`}>
                                {r.name
                                  .split(" ")
                                  .map((x) => x[0])
                                  .slice(0, 2)
                                  .join("")}
                              </div>
                              <b>{r.name}</b>
                            </div>
                          </td>
                          <td className="muted-cell">{r.id}</td>
                          <td>{r.household}</td>
                          <td>{r.purok}</td>
                          <td>{r.age}</td>
                          <td>{r.phone}</td>
                          <td>
                            <span
                              className={`status-badge ${statusTone(r.status)}`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td>
                            <button
                              className="row-menu"
                              onClick={() => openResident(r)}
                            >
                              •••
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filtered.length && (
                    <Empty text="No residents match your search." />
                  )}
                </div>
              </section>
              <div className="directory-foot">
                Showing <b>{filtered.length}</b> of <b>{residents.length}</b>{" "}
                registered residents{" "}
                <span>
                  Page 1 of 1 · <button disabled>‹</button>{" "}
                  <button disabled>›</button>
                </span>
              </div>
            </>
          )}
          {page === "Households" && (
            <>
              <PageHeading
                eyebrow="COMMUNITY DIRECTORY"
                title="Households"
                subtitle="Browse families and their registered members."
                action={
                  <button
                    className="primary-button"
                    onClick={() =>
                      announce("Add a resident to create a new household")
                    }
                  >
                    ＋ Add household
                  </button>
                }
              />
              <div className="household-grid">
                {[...new Set(residents.map((r) => r.household))].map((h, i) => {
                  const members = residents.filter((r) => r.household === h);
                  return (
                    <div className="panel household-card" key={h}>
                      <div className={`house-icon tone-${i % 4}`}>⌂</div>
                      <div className="household-title">
                        <h3>{h}</h3>
                        <span>{members[0]?.purok}</span>
                      </div>
                      <div className="member-line">
                        <span>Household members</span>
                        <b>{members.length}</b>
                      </div>
                      <div className="member-avatars">
                        {members.slice(0, 4).map((m, idx) => (
                          <span
                            key={m.id}
                            className={`mini-avatar tone-${idx % 4}`}
                          >
                            {m.name
                              .split(" ")
                              .map((x) => x[0])
                              .slice(0, 2)
                              .join("")}
                          </span>
                        ))}
                        <small>
                          {members.map((m) => m.name.split(" ")[0]).join(", ")}
                        </small>
                      </div>
                      <button
                        className="text-link"
                        onClick={() => {
                          setPage("Residents");
                          setSearch(members[0]?.name || "");
                        }}
                      >
                        View household <span>→</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {page === "Certificate Requests" && (
            <>
              <PageHeading
                eyebrow="BARANGAY SERVICES"
                title="Certificate requests"
                subtitle="Track applications and keep residents updated on their documents."
                action={
                  <button
                    className="primary-button"
                    onClick={() => {
                      setRequestForm({
                        resident: "",
                        type: "Barangay Clearance",
                        purpose: "",
                      });
                      setModal("request");
                    }}
                  >
                    ＋ New request
                  </button>
                }
              />
              <section className="panel directory-panel">
                <div className="panel-heading request-header">
                  <div>
                    <h2>All requests</h2>
                    <p>{requests.length} applications recorded</p>
                  </div>
                  <button
                    className="filter-button"
                    onClick={() => announce("Showing all certificate requests")}
                  >
                    ☷ &nbsp;All statuses⌄
                  </button>
                </div>
                <div className="table-wrap">
                  <RequestTable requests={requests} onStatus={updateStatus} onPickupDate={updatePickupDate} onPrint={setPrintRequest} />
                </div>
              </section>
            </>
          )}
          {page === "Announcements & SMS" && (
            <>
              <PageHeading
                eyebrow="COMMUNITY COMMUNICATION"
                title="Announcements & SMS"
                subtitle="Keep residents informed with timely community updates."
                action={
                  <button
                    className="primary-button"
                    onClick={() => setModal("notice")}
                  >
                    ＋ New announcement
                  </button>
                }
              />
              <div className="sms-summary">
                <div className="panel sms-card">
                  <i className="qa green">▰</i>
                  <div>
                    <span>SMS RECIPIENTS</span>
                    <b>{residents.length.toLocaleString()}</b>
                    <small>Residents with a contact number</small>
                  </div>
                </div>
                <div className="panel sms-card">
                  <i className="qa blue">✓</i>
                  <div>
                    <span>MESSAGES QUEUED</span>
                    <b>
                      {notices.reduce((n, x) => n + x.sent, 0).toLocaleString()}
                    </b>
                    <small>Across {notices.length} announcements</small>
                  </div>
                </div>
                <div className="panel sms-card">
                  <i className="qa purple">◷</i>
                  <div>
                    <span>GATEWAY STATUS</span>
                    <b className="gateway-ready">TextBee</b>
                    <small>Configure API key and paired Android phone in PHP</small>
                  </div>
                </div>
              </div>
              <h2 className="section-title">Announcement history</h2>
              <div className="notice-list">
                {notices.map((n) => (
                  <section className="panel notice-row" key={n.id}>
                    <div className="notice-icon">▰</div>
                    <div className="notice-content">
                      <div className="notice-title-row">
                        <h3>{n.title}</h3>
                        <span className="status-badge status-green">Saved</span>
                      </div>
                      <p>{n.text}</p>
                      <div className="notice-meta">
                        <span>◷ {n.date}</span>
                        <span>♙ {n.audience}</span>
                        <span>✓ {n.sent.toLocaleString()} recipients</span>
                      </div>
                    </div>
                    <button
                      className="row-menu"
                      onClick={() =>
                        announce(
                          `${n.sent.toLocaleString()} SMS messages queued or accepted by the gateway`,
                        )
                      }
                    >
                      •••
                    </button>
                  </section>
                ))}
                {!notices.length && (
                  <div className="panel">
                    <Empty text="No announcements yet. Create one to notify residents." />
                  </div>
                )}
              </div>
            </>
          )}
          {page === "Documents" && auth.role === "admin" && (
            <>
              <PageHeading
                eyebrow="BARANGAY RECORDS"
                title="Document register"
                subtitle="Record newly created and implemented barangay documents. Attachments are stored privately and administrator-only."
                action={<button className="primary-button" onClick={() => setModal("document")}>＋ Add document</button>}
              />
              <section className="panel directory-panel">
                <div className="panel-heading request-header">
                  <div>
                    <h2>Barangay documents</h2>
                    <p>{documents.length} documents recorded</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="document-table">
                    <thead><tr><th>TITLE</th><th>TYPE</th><th>DOCUMENT DATE</th><th>STATUS</th><th>ATTACHMENT</th><th>ADDED BY</th></tr></thead>
                    <tbody>
                      {documents.map((item) => (
                        <tr key={item.id}>
                          <td><b>{item.title}</b>{item.description && <small className="table-sub document-description">{item.description}</small>}</td>
                          <td>{item.document_type}</td>
                          <td>{item.document_date}</td>
                          <td><span className={`document-status document-status-${item.status}`}>{item.status}</span></td>
                          <td>{item.original_file_name ? <button className="text-link" onClick={() => downloadDocument(item)}>Download PDF</button> : <span className="document-no-file">No attachment</span>}</td>
                          <td>{item.added_by || "Administrator"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!documents.length && <Empty text="No documents recorded. Add a document to start the register." />}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
      {mobileNav && (
        <button
          className="nav-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close menu"
        />
      )}
      {toast && (
        <div className="toast">
          <span>✓</span>
          {toast}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal("");
          }}
        >
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="eyebrow">
                  {modal === "resident"
                    ? "COMMUNITY DIRECTORY"
                    : modal === "request"
                      ? "BARANGAY SERVICES"
                      : modal === "document"
                        ? "BARANGAY RECORDS"
                        : "COMMUNITY COMMUNICATION"}
                </div>
                <h2>
                  {modal === "resident"
                    ? selected
                      ? "Edit resident"
                      : "Register a resident"
                    : modal === "request"
                      ? "New certificate request"
                      : modal === "document"
                        ? "Add barangay document"
                        : "New announcement"}
                </h2>
              </div>
              <button className="close-button" onClick={() => setModal("")}>
                ×
              </button>
            </div>
            {modal === "resident" && (
              <form onSubmit={submitResident} className="form-grid">
                <label className="span-2">
                  Full name
                  <input
                    required
                    value={residentForm.name}
                    onChange={(e) =>
                      setResidentForm({ ...residentForm, name: e.target.value })
                    }
                    placeholder="Enter resident's full name"
                  />
                </label>
                <label>
                  Household
                  <input
                    required
                    value={residentForm.household}
                    onChange={(e) =>
                      setResidentForm({
                        ...residentForm,
                        household: e.target.value,
                      })
                    }
                    placeholder="e.g. Santos Household"
                  />
                </label>
                <label>
                  Purok
                  <select
                    value={residentForm.purok}
                    onChange={(e) =>
                      setResidentForm({
                        ...residentForm,
                        purok: e.target.value,
                      })
                    }
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n}>Purok {n}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Date of birth
                  <input
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={residentForm.birth_date || ""}
                    onChange={(e) =>
                      setResidentForm({
                        ...residentForm,
                        birth_date: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Mobile number
                  <input
                    required
                    value={residentForm.phone}
                    onChange={(e) =>
                      setResidentForm({
                        ...residentForm,
                        phone: e.target.value,
                      })
                    }
                    placeholder="09XX XXX XXXX"
                  />
                </label>
                {(!selected || ["admin", "secretary", "staff"].includes(auth.role)) && (
                  <>
                    <label className="span-2">
                      Resident login email
                      <input
                        required
                        type="email"
                        maxLength={254}
                        autoComplete="email"
                        value={residentForm.email || ""}
                        onChange={(e) => setResidentForm({ ...residentForm, email: e.target.value })}
                        placeholder="resident@example.com"
                      />
                    </label>
                    <label className="span-2">
                      {selected ? (Number(selected.has_login) ? "New password (optional)" : "Create password for resident") : "Temporary password"}
                      <input
                        required={!selected || !Number(selected.has_login)}
                        type="password"
                        minLength={10}
                        maxLength={200}
                        autoComplete="new-password"
                        value={residentForm.password}
                        onChange={(e) => setResidentForm({ ...residentForm, password: e.target.value })}
                        placeholder={selected && Number(selected.has_login) ? "Leave blank to keep current password" : "At least 10 characters"}
                      />
                      <small className="account-password-note">{selected && Number(selected.has_login) ? "A new password replaces the current one. The current password is never shown." : "Give the password to the resident securely. They can sign in with this email and password."}</small>
                    </label>
                  </>
                )}
                <label className="consent-control span-2">
                  <input
                    type="checkbox"
                    checked={Boolean(residentForm.sms_opt_in)}
                    onChange={(e) =>
                      setResidentForm({
                        ...residentForm,
                        sms_opt_in: e.target.checked,
                      })
                    }
                  />{" "}
                  Resident has consented to receive SMS announcements
                </label>
                <div className="form-actions span-2">
                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => setModal("")}
                  >
                    Cancel
                  </button>
                  <button className="primary-button">
                    {selected ? "Save changes" : "Register resident"}
                  </button>
                </div>
              </form>
            )}
            {modal === "request" && (
              <form onSubmit={submitRequest} className="form-grid">
                <label className="span-2">
                  Resident
                  <select
                    required
                    value={requestForm.resident}
                    onChange={(e) =>
                      setRequestForm({
                        ...requestForm,
                        resident: e.target.value,
                      })
                    }
                  >
                    <option value="">Select a resident</option>
                    {residents.map((r) => (
                      <option key={r.id}>{r.name}</option>
                    ))}
                  </select>
                </label>
                <label className="span-2">
                  Document type
                  <select
                    value={requestForm.type}
                    onChange={(e) =>
                      setRequestForm({ ...requestForm, type: e.target.value })
                    }
                  >
                    <option>Barangay Clearance</option>
                    <option>Certificate of Indigency</option>
                    <option>Certificate of Residency</option>
                    <option>Business Clearance</option>
                  </select>
                </label>
                <label className="span-2">
                  Purpose
                  <input
                    required
                    value={requestForm.purpose}
                    onChange={(e) =>
                      setRequestForm({
                        ...requestForm,
                        purpose: e.target.value,
                      })
                    }
                    placeholder="What is this document for?"
                  />
                </label>
                <div className="form-actions span-2">
                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => setModal("")}
                  >
                    Cancel
                  </button>
                  <button className="primary-button">Save request</button>
                </div>
              </form>
            )}
            {modal === "notice" && (
              <form onSubmit={submitNotice} className="form-grid">
                <label className="span-2">
                  Announcement title
                  <input
                    required
                    value={noticeForm.title}
                    onChange={(e) =>
                      setNoticeForm({ ...noticeForm, title: e.target.value })
                    }
                    placeholder="e.g. Barangay Assembly Meeting"
                  />
                </label>
                <label className="span-2">
                  Message
                  <textarea
                    required
                    maxLength="300"
                    rows="4"
                    value={noticeForm.text}
                    onChange={(e) =>
                      setNoticeForm({ ...noticeForm, text: e.target.value })
                    }
                    placeholder="Write a clear message for residents..."
                  />
                  <small className="char-count">
                    {noticeForm.text.length}/300 characters
                  </small>
                </label>
                <label className="span-2">
                  Send to
                  <select
                    value={noticeForm.audience}
                    onChange={(e) =>
                      setNoticeForm({ ...noticeForm, audience: e.target.value })
                    }
                  >
                    <option>All residents</option>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n}>Purok {n}</option>
                    ))}
                  </select>
                </label>
                <div className="sms-note span-2">
                  SMS is sent through TextBee after saving. Residents must opt in and have a valid phone number.
                </div>
                <div className="form-actions span-2">
                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => setModal("")}
                  >
                    Cancel
                  </button>
                  <button className="primary-button">Save announcement</button>
                </div>
              </form>
            )}
            {modal === "document" && (
              <form onSubmit={submitDocument} className="form-grid">
                <label className="span-2">
                  Document title
                  <input required maxLength="160" value={documentForm.title} onChange={(e) => setDocumentForm({ ...documentForm, title: e.target.value })} placeholder="e.g. Barangay Disaster Preparedness Plan" />
                </label>
                <label>
                  Document type
                  <select value={documentForm.document_type} onChange={(e) => setDocumentForm({ ...documentForm, document_type: e.target.value })}>
                    <option>Policy</option><option>Resolution</option><option>Ordinance</option><option>Plan</option><option>Report</option><option>Form</option><option>Other</option>
                  </select>
                </label>
                <label>
                  Status
                  <select value={documentForm.status} onChange={(e) => setDocumentForm({ ...documentForm, status: e.target.value })}>
                    <option value="draft">Draft</option><option value="implemented">Implemented</option><option value="archived">Archived</option>
                  </select>
                </label>
                <label className="span-2">
                  Document date
                  <input required type="date" value={documentForm.document_date} onChange={(e) => setDocumentForm({ ...documentForm, document_date: e.target.value })} />
                </label>
                <label className="span-2">
                  Description
                  <textarea maxLength="2000" rows="3" value={documentForm.description} onChange={(e) => setDocumentForm({ ...documentForm, description: e.target.value })} placeholder="Short summary or implementation notes" />
                </label>
                <label className="span-2">
                  PDF attachment (optional, max 10 MB)
                  <input type="file" accept="application/pdf,.pdf" onChange={(e) => setDocumentForm({ ...documentForm, file: e.target.files?.[0] || null })} />
                </label>
                <div className="sms-note span-2">Only administrators can view and download documents. Uploaded PDFs are stored in a protected server directory.</div>
                <div className="form-actions span-2">
                  <button type="button" className="outline-button" onClick={() => setModal("")}>Cancel</button>
                  <button className="primary-button">Add document</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {printRequest && (
        <div className="print-preview-backdrop" role="dialog" aria-modal="true" aria-label="Printable certificate">
          <div className="print-preview">
            <div className="print-controls">
              <p>Review the resident details, then print and complete the required signatures and barangay seal.</p>
              <button className="outline-button" onClick={() => setPrintRequest(null)}>Close</button>
              <button className="primary-button" onClick={() => window.print()}>Print certificate</button>
            </div>
            <PrintableRequest request={printRequest} />
          </div>
        </div>
      )}
    </div>
  );
}
function ResidentPortal({ user, resident, requests, notices, onRequest, onSavePreferences, onRefresh, onLogout }) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestType, setRequestType] = useState("Barangay Clearance");
  const [requestPurpose, setRequestPurpose] = useState("");
  const [requestError, setRequestError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [contactPhone, setContactPhone] = useState(resident?.phone || "");
  const [smsOptIn, setSmsOptIn] = useState(Boolean(Number(resident?.sms_opt_in)));
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [preferencesError, setPreferencesError] = useState("");
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const savePreferences = async (event) => {
    event.preventDefault();
    setPreferencesSaving(true);
    setPreferencesError("");
    setPreferencesMessage("");
    try {
      await onSavePreferences({ phone: contactPhone, sms_opt_in: smsOptIn ? 1 : 0 });
      setPreferencesMessage("Your contact preferences have been saved.");
    } catch (error) {
      setPreferencesError(error.message || "Could not save your contact preferences.");
    } finally {
      setPreferencesSaving(false);
    }
  };
  const submitOwnRequest = async (event) => {
    event.preventDefault();
    if (!resident) return;
    setRequestSubmitting(true);
    setRequestError("");
    setRequestSuccess("");
    try {
      const result = await onRequest({
        resident_id: resident.db_id,
        document_type: requestType,
        purpose: requestPurpose.trim(),
      });
      setRequestPurpose("");
      setRequestOpen(false);
      setRequestSuccess(`Request ${result.id} was submitted. You can check its status below.`);
    } catch (error) {
      setRequestError(error.message || "Could not submit the certificate request.");
    } finally {
      setRequestSubmitting(false);
    }
  };
  return (
    <div className="resident-shell">
      <header className="resident-header">
        <div className="brand">
          <BrandLogo />
          <div>
            <strong>Barangay Bungahin</strong>
            <span>RESIDENT SERVICES</span>
          </div>
        </div>
        <div className="resident-user">
          <button className="outline-button" onClick={onRefresh} title="Reload records from the database">
            Refresh
          </button>
          <span className="top-avatar">
            {user.full_name
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </span>
          <b>{user.full_name}</b>
          <button className="outline-button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="resident-content">
        <div className="eyebrow">RESIDENT DASHBOARD</div>
        <h1>Welcome, {user.full_name.split(" ")[0]}</h1>
        <p className="resident-intro">
          Your barangay information and service updates in one place.
        </p>
        {resident ? (
          <>
            <div className="resident-stats">
              <div className="panel resident-stat-blue">
                <span><i aria-hidden="true" />RESIDENT ID</span>
                <b>{resident.id}</b>
              </div>
              <div className="panel resident-stat-purple">
                <span><i aria-hidden="true" />PUROK</span>
                <b>{resident.purok}</b>
              </div>
              <div className="panel resident-stat-orange">
                <span><i aria-hidden="true" />MY REQUESTS</span>
                <b>{requests.length}</b>
              </div>
            </div>
            <div className="resident-grid">
              <section className="panel resident-panel">
                <div className="panel-heading">
                  <div>
                    <h2>My resident record</h2>
                    <p>
                      Contact your barangay office if any information needs
                      correction.
                    </p>
                  </div>
                </div>
                <div className="resident-details">
                  <div>
                    <small>Full name</small>
                    <b>{resident.name}</b>
                  </div>
                  <div>
                    <small>Household</small>
                    <b>{resident.household || "Not listed"}</b>
                  </div>
                  <div>
                    <small>Date of birth</small>
                    <b>{resident.birth_date || "Not provided"}</b>
                  </div>
                  <div>
                    <small>Mobile number</small>
                    <b>{resident.phone || "Not provided"}</b>
                  </div>
                  <div>
                    <small>Account status</small>
                    <b>{resident.status}</b>
                  </div>
                </div>
                <form className="resident-preferences" onSubmit={savePreferences}>
                  <h3>Contact preferences</h3>
                  <label>
                    Mobile number
                    <input type="tel" maxLength={20} value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="09XXXXXXXXX" />
                  </label>
                  <label className="resident-consent">
                    <input type="checkbox" checked={smsOptIn} onChange={(event) => setSmsOptIn(event.target.checked)} />
                    I agree to receive barangay announcements by SMS.
                  </label>
                  <div className="resident-preference-actions">
                    <button className="primary-button" disabled={preferencesSaving}>
                      {preferencesSaving ? "Saving…" : "Save preferences"}
                    </button>
                    {preferencesMessage && <span className="resident-feedback resident-success" role="status">{preferencesMessage}</span>}
                    {preferencesError && <span className="resident-feedback resident-error" role="alert">{preferencesError}</span>}
                  </div>
                </form>
              </section>
              <section className="panel resident-panel">
                <div className="panel-heading">
                  <div>
                    <h2>My certificate requests</h2>
                    <p>Updates on documents you have requested</p>
                  </div>
                  <button className="primary-button" onClick={() => { setRequestError(""); setRequestOpen((open) => !open); }}>
                    {requestOpen ? "Cancel" : "＋ New request"}
                  </button>
                </div>
                {requestSuccess && <p className="resident-feedback resident-success" role="status">{requestSuccess}</p>}
                {requestOpen && (
                  <form className="resident-request-form" onSubmit={submitOwnRequest}>
                    <label>
                      Document type
                      <select value={requestType} onChange={(event) => setRequestType(event.target.value)}>
                        <option>Barangay Clearance</option>
                        <option>Certificate of Indigency</option>
                        <option>Certificate of Residency</option>
                        <option>Business Clearance</option>
                      </select>
                    </label>
                    <label>
                      Purpose
                      <input required maxLength={255} value={requestPurpose} onChange={(event) => setRequestPurpose(event.target.value)} placeholder="What do you need the document for?" />
                    </label>
                    {requestError && <p className="resident-feedback resident-error" role="alert">{requestError}</p>}
                    <button className="primary-button" disabled={requestSubmitting}>
                      {requestSubmitting ? "Submitting…" : "Submit request"}
                    </button>
                  </form>
                )}
                {requests.length ? (
                  <div className="resident-list">
                    {requests.map((item) => (
                      <div className="resident-list-item" key={item.db_id}>
                        <div>
                          <b>{item.type}</b>
                          <small>
                            {item.id} · {item.date}
                          </small>
                          <small>{item.purpose}</small>
                          <PickupEstimate date={item.estimated_pickup_date} status={item.status} />
                        </div>
                        <span className={`status-badge ${statusTone(item.status)}`}>
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty text="No certificate requests yet." />
                )}
              </section>
            </div>
            <section className="panel resident-panel resident-notices">
              <div className="panel-heading">
                <div>
                  <h2>Barangay announcements</h2>
                  <p>Community updates and important notices</p>
                </div>
              </div>
              {notices.length ? (
                notices.slice(0, 5).map((notice) => (
                  <div className="resident-list-item" key={notice.id}>
                    <div>
                      <b>{notice.title}</b>
                      <small>
                        {notice.date} · {notice.audience}
                      </small>
                      <small>{notice.text}</small>
                    </div>
                  </div>
                ))
              ) : (
                <Empty text="There are no announcements yet." />
              )}
            </section>
          </>
        ) : (
          <div className="panel resident-missing">
            Your resident profile could not be found. Please contact the
            barangay office.
          </div>
        )}
      </main>
    </div>
  );
}

function LoginPage({ onLogin, error }) {
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    await onLogin(credentials);
    setSubmitting(false);
  };
  return (
    <main className="login-page">
      <div className="login-art">
        <div className="login-art-top">
          <BrandLogo className="login-seal" />
          <div>
            <strong>Barangay Bungahin</strong>
            <span>INFORMATION MANAGEMENT SYSTEM</span>
          </div>
        </div>
        <div className="login-art-copy">
          <span className="eyebrow">LOCAL GOVERNANCE, MADE SIMPLE</span>
          <h1>
            Service begins
            <br />
            with a <em>stronger</em>
            <br />
            community.
          </h1>
          <p>
            One place for resident records, barangay services, and community
            updates.
          </p>
          <div className="login-decoration">
            <span>⌂</span>
            <span>♙</span>
            <span>✦</span>
          </div>
        </div>
        <div className="login-art-footer">
          BARANGAY BUNGAHIN <span>•</span> ISABELA, NEGROS OCCIDENTAL
        </div>
      </div>
      <section className="login-form-side">
        <div className="login-form-wrap">
          <div className="login-mobile-brand">
            <BrandLogo />
            <strong>Barangay Bungahin</strong>
          </div>
          <div className="login-heading">
            <h2>Welcome back</h2>
            <p>Sign in to continue to your dashboard.</p>
          </div>
          <form className="login-form" onSubmit={submit}>
            <label>
              Email or username
              <div className="login-input">
                <span>♙</span>
                <input
                  required
                  autoFocus
                  autoComplete="username"
                  value={credentials.username}
                  onChange={(e) =>
                    setCredentials({ ...credentials, username: e.target.value })
                  }
                  placeholder="Enter email or username"
                />
              </div>
            </label>
            <label>
              Password
              <div className="login-input">
                <span>▣</span>
                <input
                  required
                  autoComplete="current-password"
                  type={showPassword ? "text" : "password"}
                  value={credentials.password}
                  onChange={(e) =>
                    setCredentials({ ...credentials, password: e.target.value })
                  }
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            {error && (
              <div className="login-error" role="alert">
                ⚠ &nbsp;{error}
              </div>
            )}
            <button
              className="primary-button login-submit"
              disabled={submitting}
            >
              {submitting ? "Signing in…" : "Sign in"}
              <span>→</span>
            </button>
          </form>
          <div className="login-help">
            Need an account? Contact your barangay administrator.
          </div>
          <aside className="login-privacy" aria-label="Privacy notice">
            <strong>Privacy notice</strong>
            <p>
              Personal information in this system is used for barangay records,
              resident service requests, and related services. It is handled in
              accordance with the Data Privacy Act of 2012 (Republic Act No. 10173).
            </p>
            <a href="https://officialgazette.gov.ph/2012/08/15/republic-act-no-10173/" target="_blank" rel="noreferrer">
              Read Republic Act No. 10173
            </a>
          </aside>
          <div className="login-secure">
            ▣ &nbsp; Authorized staff access only
          </div>
        </div>
        <footer className="login-copyright">
          © {new Date().getFullYear()} Barangay Bungahin · Information
          Management System
        </footer>
      </section>
    </main>
  );
}
function Stat({ label, value, change, icon, color }) {
  return (
    <div className={`panel stat-card stat-card-${color}`}>
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div className="stat-text">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{change}</small>
      </div>
      <button className="stat-more" title="More options">
        •••
      </button>
    </div>
  );
}
function statusTone(status) {
  const normalized = status.toLowerCase();
  if (normalized === "senior") return "status-purple";
  if (["active", "completed", "ready for pickup", "saved"].includes(normalized)) return "status-green";
  if (normalized === "processing") return "status-blue";
  if (["rejected", "inactive"].includes(normalized)) return "status-red";
  return "status-amber";
}
function PageHeading({ eyebrow, title, subtitle, action }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function RequestTable({ requests, onStatus, onPickupDate, onPrint }) {
  return (
    <table className="request-table">
      <thead>
        <tr>
          <th>REQUEST ID</th>
          <th>RESIDENT</th>
          <th>DOCUMENT TYPE</th>
          <th>DATE SUBMITTED</th>
          <th>ESTIMATED PICKUP</th>
          <th>STATUS</th>
          <th>PRINT</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => (
          <tr key={r.id}>
            <td className="id-cell">{r.id}</td>
            <td>
              <b>{r.resident}</b>
              <small className="table-sub">{r.purpose}</small>
            </td>
            <td>{r.type}</td>
            <td>{r.date}</td>
            <td>
              <input
                className="pickup-date-input"
                type="date"
                aria-label={`Estimated pickup date for request ${r.id}`}
                value={r.estimated_pickup_date || ""}
                onChange={(e) => onPickupDate(r.id, e.target.value)}
              />
            </td>
            <td>
              <select
                className={`status-select status-${r.status.toLowerCase().replaceAll(" ", "-")}`}
                value={r.status}
                onChange={(e) => onStatus(r.id, e.target.value)}
              >
                <option>Pending</option>
                <option>Processing</option>
                <option>Ready for pickup</option>
                <option>Completed</option>
                <option>Rejected</option>
              </select>
            </td>
            <td>
              <button
                className="text-link"
                disabled={!['Ready for pickup', 'Completed'].includes(r.status)}
                title={['Ready for pickup', 'Completed'].includes(r.status) ? 'Prepare a printable certificate' : 'Mark the request Ready for pickup before printing'}
                onClick={() => onPrint(r)}
              >
                Print certificate
              </button>
            </td>
            <td>
              <button
                className="row-menu"
                onClick={() =>
                  onStatus(
                    r.id,
                    r.status === "Completed" ? "Pending" : "Completed",
                  )
                }
              >
                •••
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function PrintableRequest({ request }) {
  const issuedDate = new Date().toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const residentAddress = [request.address, request.purok]
    .filter(Boolean)
    .join(", ") || "Barangay Bungahin";
  return (
    <article className="print-certificate">
      <header className="print-certificate-header">
        <div>Republic of the Philippines</div>
        <div>Province of ____________________</div>
        <div>Municipality/City of ____________________</div>
        <h1>BARANGAY BUNGAHIN</h1>
        <div>Office of the Punong Barangay</div>
      </header>
      <div className="print-certificate-rule" />
      <p className="print-certificate-kicker">REQUESTED BARANGAY DOCUMENT</p>
      <h2>{request.type.toUpperCase()}</h2>
      <p className="print-certificate-intro">TO WHOM IT MAY CONCERN:</p>
      <p className="print-certificate-body">
        This is to certify that <strong>{request.resident}</strong>, resident reference <strong>{request.resident_code || "________________"}</strong>,
        is recorded at <strong>{residentAddress}</strong>, Barangay Bungahin. This document is prepared upon the resident’s request
        for the following purpose: <strong>{request.purpose}</strong>.
      </p>
      <p className="print-certificate-body">
        Issued this {issuedDate} at Barangay Bungahin, upon the request of the above named resident.
      </p>
      <p className="print-certificate-note">Please verify the resident details and complete any required review before signing and applying the official barangay seal.</p>
      <div className="print-signatures">
        <div><span>____________________________</span><b>Barangay Secretary</b></div>
        <div><span>____________________________</span><b>Punong Barangay</b></div>
      </div>
      <footer className="print-certificate-footer">Request {request.id} · Submitted {request.date}</footer>
    </article>
  );
}
function PickupEstimate({ date, status }) {
  if (status === "Ready for pickup") return <small className="pickup-estimate pickup-estimate-ready">Available for pickup now.</small>;
  if (status === "Completed") return <small className="pickup-estimate">Request completed.</small>;
  if (status === "Rejected") return <small className="pickup-estimate">Contact the barangay office for assistance.</small>;
  if (!date) return <small className="pickup-estimate">Estimated pickup date not set yet.</small>;

  const [year, month, day] = date.split("-").map(Number);
  const pickup = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((pickup.getTime() - today.getTime()) / 86400000);
  const formattedDate = pickup.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  if (days < 0) return <small className="pickup-estimate pickup-estimate-overdue">Estimated date {formattedDate} has passed. Please contact the barangay office.</small>;
  if (days === 0) return <small className="pickup-estimate pickup-estimate-ready">Estimated pickup is today ({formattedDate}).</small>;
  return <small className="pickup-estimate">Estimated pickup in {days} day{days === 1 ? "" : "s"} ({formattedDate}).</small>;
}
function Activity({ icon, tone, title, detail, time }) {
  return (
    <div className="activity-item">
      <div className={`activity-icon ${tone}`}>{icon}</div>
      <div className="activity-copy">
        <b>{title}</b>
        <span>{detail}</span>
      </div>
      <time>{time}</time>
    </div>
  );
}
function Empty({ text }) {
  return (
    <div className="empty-state">
      <span>⌕</span>
      <p>{text}</p>
    </div>
  );
}
export default App;
