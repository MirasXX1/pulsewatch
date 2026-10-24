package dev.pulsewatch;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class Monitor {
    private static final Logger LOG = LoggerFactory.getLogger(Monitor.class);
    private final Store store;
    private final Probe probe;
    private final Set<Long> active = ConcurrentHashMap.newKeySet();
    private final ExecutorService workers = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(100), new ThreadPoolExecutor.AbortPolicy());

    public Monitor(Store store, Probe probe) {
        this.store = store;
        this.probe = probe;
    }

    public boolean active(long id) { return active.contains(id); }

    public void submit(long id) {
        Store.Site site = store.get(id);
        if (!active.add(id)) throw new Busy("A check is already running for this monitor.");
        try {
            workers.execute(() -> {
                try {
                    store.save(id, probe.check(site.url()));
                } catch (Exception exception) {
                    LOG.error("Check persistence failed for site {}", id, exception);
                } finally {
                    active.remove(id);
                }
            });
        } catch (RejectedExecutionException exception) {
            active.remove(id);
            throw new Busy("Check queue is full. Try again shortly.");
        }
    }

    @Scheduled(fixedDelay = 60000, initialDelay = 1000)
    public void tick() {
        List<Store.Site> sites = store.all().stream().sorted(Comparator.comparing(
                site -> site.latest() == null ? Instant.EPOCH : site.latest().checkedAt())).toList();
        for (Store.Site site : sites) {
            try {
                submit(site.id());
            } catch (Busy | Store.Missing ignored) {
                // An active, queued, deleted or temporarily deferred site needs no second job.
            }
        }
    }

    @PreDestroy
    void close() { workers.shutdownNow(); }

    public static class Busy extends RuntimeException {
        Busy(String message) { super(message); }
    }
}
