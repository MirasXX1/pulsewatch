package dev.pulsewatch;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.*;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

@Component
public class Probe {
    public record Result(Instant checkedAt, String status, Integer httpCode, long durationMs, String error) {}
    private record Headers(int code, String location) {}
    private static final int MAX_REDIRECTS = 5;
    private static final int MAX_HEADER_BYTES = 32768;
    private final UrlPolicy policy;
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "probe-deadlines");
        thread.setDaemon(true);
        return thread;
    });
    private final ExecutorService dns = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS,
            new SynchronousQueue<>(), runnable -> {
                Thread thread = new Thread(runnable, "probe-dns");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.AbortPolicy());

    public Probe(UrlPolicy policy) { this.policy = policy; }

    public static boolean isUp(int code) { return code >= 200 && code <= 399; }

    public Result check(String url) {
        Instant at = Instant.now();
        long start = System.nanoTime(), deadline = start + TimeUnit.SECONDS.toNanos(15);
        Integer code = null;
        try {
            URI uri = policy.parse(url);
            for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
                InetAddress[] addresses = resolve(uri, deadline);
                int port = uri.getPort() == -1 ? (uri.getScheme().equals("https") ? 443 : 80) : uri.getPort();
                Headers headers;
                try (Socket raw = new Socket()) {
                    // A socket close enforces the absolute deadline during TLS and socket writes too.
                    ScheduledFuture<?> timeout = deadlines.schedule(() -> {
                        try { raw.close(); } catch (IOException ignored) {}
                    }, remaining(deadline), TimeUnit.MILLISECONDS);
                    try {
                        // Use the approved IP directly: never perform a second DNS lookup at connect time.
                        raw.connect(new InetSocketAddress(addresses[0], port), Math.min(4000, remaining(deadline)));
                        raw.setSoTimeout(remaining(deadline));
                        try (Socket socket = secureIfNeeded(raw, uri, port, deadline)) {
                            writeRequest(socket, uri);
                            headers = readHeaders(socket, deadline);
                        }
                    } finally {
                        timeout.cancel(false);
                    }
                }
                code = headers.code();
                if (Set.of(301, 302, 303, 307, 308).contains(code) && headers.location() != null) {
                    if (hop == MAX_REDIRECTS) throw new IOException("Too many redirects");
                    uri = policy.parse(uri.resolve(headers.location()).toString());
                    continue;
                }
                return new Result(at, isUp(code) ? "UP" : "DOWN", code, elapsed(start), null);
            }
            throw new IOException("Too many redirects");
        } catch (Exception exception) {
            String message;
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
                message = "Check interrupted";
            } else if (exception instanceof TimeoutException) {
                message = "DNS lookup exceeded the check deadline";
            } else if (exception instanceof RejectedExecutionException) {
                message = "DNS resolver is busy. Try again shortly.";
            } else {
                Throwable cause = exception.getCause() == null ? exception : exception.getCause();
                message = cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage();
            }
            return new Result(at, "DOWN", code, elapsed(start), message.substring(0, Math.min(message.length(), 1000)));
        }
    }

    private InetAddress[] resolve(URI uri, long deadline) throws Exception {
        Future<InetAddress[]> resolution = dns.submit(() -> policy.resolve(uri));
        try {
            return resolution.get(remaining(deadline), TimeUnit.MILLISECONDS);
        } finally {
            resolution.cancel(true);
        }
    }

    private Socket secureIfNeeded(Socket raw, URI uri, int port, long deadline) throws IOException {
        if (!uri.getScheme().equals("https")) return raw;
        // The original hostname supplies SNI and certificate hostname verification over the pinned socket.
        SSLSocket tls = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault())
                .createSocket(raw, uri.getHost(), port, true);
        SSLParameters parameters = tls.getSSLParameters();
        parameters.setEndpointIdentificationAlgorithm("HTTPS");
        tls.setSSLParameters(parameters);
        tls.setSoTimeout(remaining(deadline));
        tls.startHandshake();
        return tls;
    }

    private void writeRequest(Socket socket, URI uri) throws IOException {
        String path = uri.getRawPath();
        if (path == null || path.isEmpty()) path = "/";
        if (uri.getRawQuery() != null) path += "?" + uri.getRawQuery();
        String request = "GET " + path + " HTTP/1.1\r\nHost: " + uri.getRawAuthority()
                + "\r\nUser-Agent: PulseWatch/0.1\r\nConnection: close\r\nAccept: */*\r\n\r\n";
        socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
    }

    private Headers readHeaders(Socket socket, long deadline) throws IOException {
        InputStream input = socket.getInputStream();
        int total = 0, code;
        String header;
        do {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            int state = 0;
            while (state != 4) {
                socket.setSoTimeout(remaining(deadline));
                int character = input.read();
                if (character < 0) throw new IOException("Incomplete HTTP headers");
                if (++total > MAX_HEADER_BYTES) throw new IOException("HTTP headers exceed 32 KB");
                bytes.write(character);
                state = switch (state) {
                    case 0 -> character == 13 ? 1 : 0;
                    case 1 -> character == 10 ? 2 : 0;
                    case 2 -> character == 13 ? 3 : 0;
                    default -> character == 10 ? 4 : 0;
                };
            }
            header = bytes.toString(StandardCharsets.ISO_8859_1);
            String[] status = header.split("\r\n", 2)[0].split(" ", 3);
            if (status.length < 2 || !status[0].matches("HTTP/1[.][01]")) {
                throw new IOException("Invalid HTTP response");
            }
            try { code = Integer.parseInt(status[1]); }
            catch (NumberFormatException exception) { throw new IOException("Invalid HTTP status"); }
            if (code < 100 || code > 599) throw new IOException("Invalid HTTP status");
        } while (code >= 100 && code < 200 && code != 101);
        String location = null;
        for (String line : header.split("\r\n")) {
            if (line.toLowerCase(Locale.ROOT).startsWith("location:")) location = line.substring(9).trim();
        }
        return new Headers(code, location);
    }

    private static long elapsed(long start) { return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start); }

    private static int remaining(long deadline) throws SocketTimeoutException {
        long ms = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
        if (ms <= 0) throw new SocketTimeoutException("15 second check deadline exceeded");
        return (int) ms;
    }

    @PreDestroy
    void close() { dns.shutdownNow(); deadlines.shutdownNow(); }
}
