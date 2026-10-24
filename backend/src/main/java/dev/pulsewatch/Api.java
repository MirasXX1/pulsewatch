package dev.pulsewatch;

import java.util.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sites")
public class Api {
    private final Store store;
    private final Monitor monitor;
    private final UrlPolicy policy;

    public Api(Store store, Monitor monitor, UrlPolicy policy) {
        this.store = store;
        this.monitor = monitor;
        this.policy = policy;
    }

    record Input(@NotBlank @Size(max = 100) String name, @NotBlank @Size(max = 2048) String url) {}

    private Store.Site decorate(Store.Site site) {
        return new Store.Site(site.id(), site.name(), site.url(), site.createdAt(), site.status(),
                site.totalChecks(), site.successfulChecks(), site.successRate(), site.latest(), monitor.active(site.id()));
    }

    @GetMapping
    public List<Store.Site> list() { return store.all().stream().map(this::decorate).toList(); }

    @PostMapping
    public ResponseEntity<Store.Site> add(@Valid @RequestBody Input input) {
        String url = policy.parse(input.url()).toASCIIString();
        long id = store.add(input.name().trim(), url);
        try { monitor.submit(id); }
        catch (Monitor.Busy ignored) { /* The scheduled sweep will pick up a temporarily full queue. */ }
        return ResponseEntity.status(201).body(decorate(store.get(id)));
    }

    @GetMapping("/{id}")
    public Store.Site get(@PathVariable long id) { return decorate(store.get(id)); }

    @GetMapping("/{id}/checks")
    public List<Store.Check> history(@PathVariable long id) {
        store.get(id);
        return store.history(id, 100);
    }

    @PostMapping("/{id}/check")
    public ResponseEntity<Void> check(@PathVariable long id) {
        monitor.submit(id);
        return ResponseEntity.accepted().build();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable long id) {
        store.delete(id);
        return ResponseEntity.noContent().build();
    }
}
