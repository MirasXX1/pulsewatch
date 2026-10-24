package dev.pulsewatch;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.*;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ApiTest {
    private MockMvc api;
    private Monitor monitor;
    private Probe probe;

    @BeforeEach void init() {
        Store store = new Store(null) {
            @Override public Site get(long id) {
                if (id != 1) throw new Missing();
                return new Site(1, "Example", "https://example.com", Instant.EPOCH,
                        "PENDING", 0, 0, null, null, false);
            }
            @Override public List<Site> all() { return List.of(get(1)); }
            @Override public List<Check> history(long id, int limit) { return List.of(); }
            @Override public long add(String name, String url) { return 1; }
            @Override public void save(long id, Probe.Result result) {}
            @Override public void delete(long id) { get(id); }
        };
        probe = new Probe(new UrlPolicy()) {
            @Override public Result check(String url) { return new Result(Instant.now(), "UP", 200, 1, null); }
        };
        monitor = new Monitor(store, probe);
        api = MockMvcBuilders.standaloneSetup(new Api(store, monitor, new UrlPolicy()))
                .setControllerAdvice(new Errors()).build();
    }

    @AfterEach void close() { monitor.close(); probe.close(); }

    @Test void listsRealPendingState() throws Exception {
        api.perform(get("/api/sites")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].status").value("PENDING"))
                .andExpect(jsonPath("$[0].totalChecks").value(0))
                .andExpect(jsonPath("$[0].successRate").isEmpty());
    }
    @Test void createsMonitor() throws Exception {
        api.perform(post("/api/sites").contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Example\",\"url\":\"https://example.com\"}"))
                .andExpect(status().isCreated());
    }
    @Test void rejectsInvalidInput() throws Exception {
        api.perform(post("/api/sites").contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"  \",\"url\":\"https://example.com\"}"))
                .andExpect(status().isBadRequest());
    }
    @Test void rejectsPrivateLiteral() throws Exception {
        api.perform(post("/api/sites").contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Private\",\"url\":\"http://169.254.169.254\"}"))
                .andExpect(status().isBadRequest());
    }
    @Test void missingSiteReturns404() throws Exception {
        api.perform(get("/api/sites/999")).andExpect(status().isNotFound());
    }
    @Test void checkIsAsynchronous() throws Exception {
        api.perform(post("/api/sites/1/check")).andExpect(status().isAccepted());
    }
    @Test void rejectsMalformedJson() throws Exception {
        api.perform(post("/api/sites").contentType(MediaType.APPLICATION_JSON).content("{"))
                .andExpect(status().isBadRequest());
    }
    @Test void rejectsNonNumericId() throws Exception {
        api.perform(get("/api/sites/invalid")).andExpect(status().isBadRequest());
    }
    @Test void deletesMonitor() throws Exception {
        api.perform(delete("/api/sites/1")).andExpect(status().isNoContent());
    }
}
