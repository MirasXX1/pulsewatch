package dev.pulsewatch;

import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.*;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class Store {
    public record Check(long id, Instant checkedAt, String status, Integer httpCode, long durationMs, String error) {}
    public record Site(long id, String name, String url, Instant createdAt, String status,
                       long totalChecks, long successfulChecks, Double successRate, Check latest, boolean checking) {}

    // One database snapshot supplies both the latest result and the success ratio.
    private static final String SELECT = """
        SELECT s.*, stats.total, stats.successful,
               c.id AS check_id, c.checked_at, c.status, c.http_code, c.duration_ms, c.error
        FROM sites s
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'UP') AS successful
            FROM checks WHERE site_id = s.id
        ) stats ON true
        LEFT JOIN LATERAL (
            SELECT * FROM checks WHERE site_id = s.id ORDER BY checked_at DESC, id DESC LIMIT 1
        ) c ON true
        """;
    private final JdbcTemplate db;

    public Store(JdbcTemplate db) { this.db = db; }

    private Check check(ResultSet r) throws SQLException {
        return new Check(r.getLong("id"), r.getTimestamp("checked_at").toInstant(), r.getString("status"),
                (Integer) r.getObject("http_code"), r.getLong("duration_ms"), r.getString("error"));
    }

    private Site site(ResultSet r) throws SQLException {
        long total = r.getLong("total"), successful = r.getLong("successful");
        Check latest = r.getObject("check_id") == null ? null : new Check(r.getLong("check_id"),
                r.getTimestamp("checked_at").toInstant(), r.getString("status"),
                (Integer) r.getObject("http_code"), r.getLong("duration_ms"), r.getString("error"));
        return new Site(r.getLong("id"), r.getString("name"), r.getString("url"),
                r.getTimestamp("created_at").toInstant(), latest == null ? "PENDING" : latest.status(),
                total, successful, total == 0 ? null : 100.0 * successful / total, latest, false);
    }

    public List<Site> all() {
        return db.query(SELECT + " ORDER BY s.id DESC", (r, n) -> site(r));
    }

    public Site get(long id) {
        return db.query(SELECT + " WHERE s.id = ?", (r, n) -> site(r), id)
                .stream().findFirst().orElseThrow(Missing::new);
    }

    public List<Check> history(long id, int limit) {
        return db.query("SELECT * FROM checks WHERE site_id = ? ORDER BY checked_at DESC, id DESC LIMIT ?",
                (r, n) -> check(r), id, limit);
    }

    public long add(String name, String url) {
        KeyHolder key = new GeneratedKeyHolder();
        db.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO sites(name,url) VALUES (?,?)", new String[]{"id"});
            statement.setString(1, name);
            statement.setString(2, url);
            return statement;
        }, key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }

    public void save(long id, Probe.Result result) {
        // A finished in-flight check must not recreate a monitor deleted by the user.
        db.update("""
            INSERT INTO checks(site_id,checked_at,status,http_code,duration_ms,error)
            SELECT id,?,?,?,?,? FROM sites WHERE id=?
            """, Timestamp.from(result.checkedAt()), result.status(), result.httpCode(),
                result.durationMs(), result.error(), id);
    }

    @Transactional
    public void delete(long id) {
        if (db.update("DELETE FROM sites WHERE id=?", id) == 0) throw new Missing();
    }

    public static class Missing extends RuntimeException {}
}
