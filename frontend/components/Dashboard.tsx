"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/i18n/LocaleProvider";
import { errorKey } from "@/i18n/errors";
import type { MessageKey, Params } from "@/i18n/messages";

type Notice = { key: MessageKey; params?: Params };
function ErrorText({
  message,
  kind = "request",
}: {
  message: string;
  kind?: "request" | "check";
}) {
  const { t } = useLocale();
  const key = errorKey(message, kind);
  return (
    <div>
      {t(key)}
      {(key === "checkError" || key === "requestError") &&
        !message.startsWith("pulsewatch:") && (
          <details className="technical-details">
            <summary>{t("technicalDetails")}</summary>
            <code>{message}</code>
          </details>
        )}
    </div>
  );
}
type Check = {
  id: number;
  checkedAt: string;
  status: string;
  httpCode: number | null;
  durationMs: number;
  error: string | null;
};
type Site = {
  id: number;
  name: string;
  url: string;
  status: string;
  totalChecks: number;
  successfulChecks: number;
  successRate: number | null;
  latest: Check | null;
  checking: boolean;
};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/sites${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  }).catch(() => {
    throw new Error("pulsewatch:network");
  });
  if (!r.ok) {
    let message = "pulsewatch:request";
    try {
      message = (await r.json()).message || message;
    } catch {}
    throw Error(message);
  }
  return r.status === 204 || r.status === 202 ? (undefined as T) : r.json();
}
function Status({ value }: { value: string }) {
  const { t } = useLocale();
  const key =
    value === "UP"
      ? "statusUp"
      : value === "DOWN"
        ? "statusDown"
        : value === "PENDING"
          ? "statusPending"
          : "statusUnknown";
  return (
    <span className={`status ${value.toLowerCase()}`}>
      <i />
      {t(key)}
    </span>
  );
}
export default function Dashboard({ id }: { id?: string }) {
  const { t, formatDate, formatNumber, formatPercent } = useLocale();
  const [sites, setSites] = useState<Site[]>([]),
    [history, setHistory] = useState<Check[]>([]),
    [loading, setLoading] = useState(true),
    [hasData, setHasData] = useState(false),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [notice, setNotice] = useState<Notice | null>(null);
  const [adding, setAdding] = useState(false),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<number[]>([]),
    [deleting, setDeleting] = useState<Site | null>(null),
    [search, setSearch] = useState("");
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      let nextSites: Site[];
      let nextHistory: Check[] = [];
      if (id) {
        const [site, checks] = await Promise.all([
          api<Site>(`/${id}`),
          api<Check[]>(`/${id}/checks`),
        ]);
        nextSites = [site];
        nextHistory = checks;
      } else nextSites = await api<Site[]>("");
      if (version !== loadVersion.current) return;
      setSites(nextSites);
      setHistory(nextHistory);
      setHasData(true);
      // Background polling must not dismiss an error from an add/check/delete action.
      setLoadError("");
    } catch (e) {
      if (version === loadVersion.current) setLoadError((e as Error).message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      clearInterval(timer);
      // Ignore responses that arrive after unmount or navigation.
      loadVersion.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!adding && !deleting) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setAdding(false);
        setDeleting(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [adding, deleting, busy]);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim() || name.length > 100 || !url.trim() || url.length > 2048) {
      setError("pulsewatch:validation");
      return;
    }
    try {
      const target = new URL(url.trim());
      if (!["http:", "https:"].includes(target.protocol) || !target.hostname)
        throw new Error();
    } catch {
      setError("pulsewatch:url");
      return;
    }
    setBusy(true);
    try {
      await api("", { method: "POST", body: JSON.stringify({ name, url }) });
      setAdding(false);
      setName("");
      setUrl("");
      setNotice({ key: "monitorAdded" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function check(site: Site) {
    setError("");
    setPending((p) => [...p, site.id]);
    try {
      await api(`/${site.id}/check`, { method: "POST" });
      setNotice({ key: "checkQueued", params: { name: site.name } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending((p) => p.filter((v) => v !== site.id));
    }
  }
  async function remove() {
    if (!deleting) return;
    setError("");
    setBusy(true);
    try {
      await api(`/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      if (id) {
        window.location.href = "/";
        return;
      }
      setNotice({ key: "monitorDeleted" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const total = sites.reduce((a, s) => a + s.totalChecks, 0),
    success = sites.reduce((a, s) => a + s.successfulChecks, 0),
    up = sites.filter((s) => s.status === "UP").length,
    down = sites.filter((s) => s.status === "DOWN").length;
  const visible = sites.filter((s) =>
    `${s.name} ${s.url}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {id ? <Link href="/">← {t("allMonitors")}</Link> : t("heartbeat")}
          </div>
          <h1>{id ? sites[0]?.name || t("monitorDetails") : t("headline")}</h1>
          <p>{id ? sites[0]?.url : t("subtitle")}</p>
        </div>
        {!id && (
          <button className="primary" onClick={() => setAdding(true)}>
            ＋ {t("addMonitor")}
          </button>
        )}
      </div>
      {(error || loadError) && (
        <div className="alert" role="alert">
          <ErrorText message={error || loadError} />{" "}
          <button
            onClick={() => {
              setError("");
              void load();
            }}
          >
            {t("retry")}
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {t(notice.key, notice.params)}
          <button aria-label={t("dismiss")} onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
      <section className="stats" aria-label={t("summary")}>
        <div className="stat">
          <span>
            {t("totalMonitors")} <b>▦</b>
          </span>
          <strong>{!hasData ? "—" : formatNumber(sites.length)}</strong>
          <small>{t(id ? "selectedSite" : "inWorkspace")}</small>
        </div>
        <div className="stat">
          <span>
            {t("currentlyUp")} <b className="green">↗</b>
          </span>
          <strong>
            {!hasData ? "—" : formatNumber(up)}
            <em className="green">●</em>
          </strong>
          <small>
            {down ? `${t("downCount", { count: formatNumber(down) })} · ` : ""}
            {hasData
              ? t("pendingCount", {
                  count: formatNumber(
                    sites.filter((s) => s.status === "PENDING").length,
                  ),
                })
              : t("waitingData")}
          </small>
        </div>
        <div className="stat">
          <span>
            {t("successfulChecks")} <b className="green">✓</b>
          </span>
          <strong>
            {!hasData || !total ? "—" : formatPercent((success / total) * 100)}
          </strong>
          <small>
            {total
              ? t("savedRatio", {
                  success: formatNumber(success),
                  total: formatNumber(total),
                })
              : t("waitingChecks")}
          </small>
        </div>
      </section>
      {!id ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                {t("yourMonitors")}{" "}
                <span className="count">
                  {hasData ? formatNumber(sites.length) : "—"}
                </span>
              </h2>
              <p>{t("liveView")}</p>
            </div>
            <label className="search">
              <span>⌕</span>
              <input
                aria-label={t("searchLabel")}
                placeholder={t("searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          {loading ? (
            <div className="empty" role="status">
              <div className="loader" />
              {t("loadingMonitors")}
            </div>
          ) : !hasData ? (
            <div className="empty">
              <h3>{t("monitorsUnavailable")}</h3>
              <p>{t("checkConnection")}</p>
              <button onClick={() => void load()}>{t("retryLoading")}</button>
            </div>
          ) : !sites.length ? (
            <div className="empty">
              <div className="empty-icon">ϟ</div>
              <h3>{t("firstMonitor")}</h3>
              <p>{t("emptyDescription")}</p>
              <button className="primary" onClick={() => setAdding(true)}>
                ＋ {t("addFirst")}
              </button>
            </div>
          ) : !visible.length ? (
            <div className="empty">{t("noMatches")}</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("monitor")}</th>
                    <th>{t("status")}</th>
                    <th>{t("successfulChecks")}</th>
                    <th>{t("response")}</th>
                    <th>{t("lastCheck")}</th>
                    <th>
                      <span className="sr-only">{t("actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link className="monitor-name" href={`/sites/${s.id}`}>
                          <span className="website-icon">↗</span>
                          <span>
                            <strong>{s.name}</strong>
                            <small>{s.url}</small>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <Status value={s.status} />
                      </td>
                      <td>
                        <strong>
                          {s.successRate === null
                            ? "—"
                            : formatPercent(s.successRate)}
                        </strong>
                        <small>
                          {t("savedCount", {
                            count: formatNumber(s.totalChecks),
                          })}
                        </small>
                      </td>
                      <td>
                        {s.latest
                          ? t("duration", {
                              value: formatNumber(s.latest.durationMs),
                            })
                          : "—"}
                      </td>
                      <td className="date">
                        {s.latest
                          ? formatDate(s.latest.checkedAt)
                          : t("awaitingFirst")}
                      </td>
                      <td>
                        <div className="actions">
                          <button
                            disabled={s.checking || pending.includes(s.id)}
                            onClick={() => void check(s)}
                          >
                            {s.checking || pending.includes(s.id)
                              ? t("checking")
                              : t("checkNow")}
                          </button>
                          <button
                            className="delete-icon"
                            aria-label={t("deleteNamed", { name: s.name })}
                            onClick={() => setDeleting(s)}
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="panel-foot">
            <span>
              <i className="live-dot" /> {t("autoChecks")}
            </span>
            <span>{t("refreshEvery")}</span>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                {t("recentChecks")}{" "}
                {sites[0] && <Status value={sites[0].status} />}
              </h2>
              <p>{t("historyDescription")}</p>
            </div>
            {sites[0] && (
              <div className="actions">
                <button
                  disabled={sites[0].checking || pending.includes(sites[0].id)}
                  onClick={() => void check(sites[0])}
                >
                  {sites[0].checking || pending.includes(sites[0].id)
                    ? t("checking")
                    : t("checkNow")}
                </button>
                <button
                  className="danger-text"
                  onClick={() => setDeleting(sites[0])}
                >
                  {t("deleteMonitor")}
                </button>
              </div>
            )}
          </div>
          {loading ? (
            <div className="empty">{t("loadingHistory")}</div>
          ) : !hasData ? (
            <div className="empty">
              <h3>{t("historyUnavailable")}</h3>
              <p>{t("historyUnavailableDescription")}</p>
              <Link href="/">← {t("backToMonitors")}</Link>
            </div>
          ) : !history.length ? (
            <div className="empty">
              <div className="empty-icon">◷</div>
              <h3>{t("waitingHeartbeat")}</h3>
              <p>{t("historyEmpty")}</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("checkedAt")}</th>
                    <th>{t("result")}</th>
                    <th>{t("httpCode")}</th>
                    <th>{t("durationHeading")}</th>
                    <th>{t("errorHeading")}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((c) => (
                    <tr key={c.id}>
                      <td className="date">{formatDate(c.checkedAt)}</td>
                      <td>
                        <Status value={c.status} />
                      </td>
                      <td>{c.httpCode ?? "—"}</td>
                      <td>
                        {t("duration", { value: formatNumber(c.durationMs) })}
                      </td>
                      <td className="error-cell">
                        {c.error ? (
                          <ErrorText message={c.error} kind="check" />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <div className="info-strip">
        <span>ⓘ</span>
        <p>
          <strong>{t("realChecks")}</strong> {t("rules")}
        </p>
      </div>
      {adding && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-title"
          >
            <button
              className="modal-close"
              aria-label={t("close")}
              disabled={busy}
              onClick={() => setAdding(false)}
            >
              ×
            </button>
            <div className="eyebrow">{t("startMonitoring")}</div>
            <h2 id="add-title">{t("addWebsite")}</h2>
            <p>{t("newHeartbeat")}</p>
            <form onSubmit={add} noValidate>
              <label>
                {t("monitorName")}
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                />
              </label>
              <label>
                {t("websiteUrl")}
                <input
                  required
                  type="url"
                  maxLength={2048}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </label>
              <small>{t("urlHint")}</small>
              {error && (
                <div className="form-error" role="alert">
                  <ErrorText message={error} />
                </div>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAdding(false)}
                >
                  {t("cancel")}
                </button>
                <button className="primary" disabled={busy || !name.trim()}>
                  {t(busy ? "adding" : "addMonitor")}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {deleting && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <h2 id="delete-title">
              {t("deleteTitle", { name: deleting.name })}
            </h2>
            <p>{t("deleteDescription")}</p>
            {error && (
              <div className="form-error" role="alert">
                <ErrorText message={error} />
              </div>
            )}
            <div className="modal-actions">
              <button
                autoFocus
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                {t("cancel")}
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t(busy ? "deleting" : "deleteMonitor")}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
